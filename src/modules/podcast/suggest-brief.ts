import { SuggestedBriefSchema, type SuggestedBrief } from '../../domain/brief';
import type { AppConfig } from '../../config/env';
import type { Logger } from '../../utils/logger';
import { ERROR_CODES, PipelineError } from '../../domain/errors';
import { exec } from '../../utils/exec';
import { buildSuggestBriefPrompt } from './prompts/suggest-brief';
import { extractJson } from '../../ai/claude-runner';
import type { SuggestBriefInput } from '../contract';

/**
 * A single, cheap Claude Code call that drafts a starting "context" + "hook"
 * for the UI's two text boxes.
 *
 * It used to open every image in the library first, because the library was
 * what an episode could be about. It no longer does, and the `Read` grant that
 * went with it is gone: this is now text in, text out, steered by the project's
 * name and by what the channel has already made.
 *
 * Deliberately much lighter than storyboard generation - one attempt, no
 * fact-guard, no retries beyond what `exec` itself does - since a bad
 * suggestion gets edited or discarded rather than failing a job.
 */
const CLAUDE_TIMEOUT_MS = 180_000;

export async function suggestBrief(
  config: AppConfig,
  logger: Logger,
  input: SuggestBriefInput,
): Promise<SuggestedBrief> {
  const prompt = buildSuggestBriefPrompt(input);

  const result = await exec(
    config.ai.claudeBin,
    [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--model',
      config.ai.model,
      '--allowedTools',
      '',
    ],
    { timeoutMs: CLAUDE_TIMEOUT_MS },
  ).catch((err) => {
    throw new PipelineError(
      ERROR_CODES.AI_CALL_FAILED,
      'suggest-brief',
      `Could not run "${config.ai.claudeBin}": ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      { cause: err },
    );
  });

  if (result.code !== 0) {
    throw new PipelineError(
      ERROR_CODES.AI_CALL_FAILED,
      'suggest-brief',
      `Claude exited ${result.code}: ${result.stderr.trim() || result.stdout.slice(0, 400)}`,
    );
  }

  let raw = result.stdout;
  try {
    const envelope = JSON.parse(result.stdout) as { result?: unknown };
    if (typeof envelope.result === 'string') raw = envelope.result;
  } catch {
    // Fall through - a plain-text reply is still worth trying to parse.
  }

  const json = extractJson(raw);
  const parsed = json ? SuggestedBriefSchema.safeParse(json) : null;
  if (!parsed || !parsed.success) {
    throw new PipelineError(
      ERROR_CODES.AI_INVALID_OUTPUT,
      'suggest-brief',
      'Claude did not return a valid { context, hook } suggestion.',
    );
  }

  logger.done('Suggested context + hook from photos');
  return parsed.data;
}
