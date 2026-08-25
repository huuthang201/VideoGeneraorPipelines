import { SuggestedBriefSchema, type SuggestedBrief } from '../../domain/brief';
import type { AppConfig } from '../../config/env';
import type { Logger } from '../../utils/logger';
import { ERROR_CODES, PipelineError } from '../../domain/errors';
import { exec } from '../../utils/exec';
import type { ShortsPrompts, SuggestBriefPromptInput } from './prompts';
import { extractJson } from '../../ai/claude-runner';

/**
 * A single, cheap Claude Code call that drafts a starting "context" + "hook"
 * for the UI's two text boxes. Deliberately much lighter than storyboard
 * generation (one attempt, no fact-guard, no retries beyond what `exec` itself
 * does) since a bad suggestion just gets edited or discarded by the user rather
 * than failing a job.
 */
const CLAUDE_TIMEOUT_MS = 120_000;

export function makeSuggestBrief(prompts: ShortsPrompts) {
  return async function suggestBrief(
  config: AppConfig,
  logger: Logger,
  input: SuggestBriefPromptInput,
): Promise<SuggestedBrief> {
  const prompt = prompts.buildSuggestBriefPrompt(input);

  const result = await exec(
    config.ai.claudeBin,
    [
      '-p',
      prompt,
      '--output-format',
      'json',
      '--model',
      config.ai.model,
      // No tools: this call is text in, text out.
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

  logger.done(`Suggested a subject around "${input.topic}"`);
  return parsed.data;
  };
}
