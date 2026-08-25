import type { AppConfig } from '../config/env';
import type { Logger } from '../utils/logger';
import { ERROR_CODES, PipelineError } from '../domain/errors';
import { exec } from '../utils/exec';
import { withRetry } from '../utils/retry';

/**
 * Getting a reply out of the Claude Code CLI.
 *
 * Transport only - spawning the binary, unwrapping the envelope, retrying a
 * dropped call, and finding the JSON object in a reply. What is *in* that reply
 * and whether it is acceptable is the module's business, because the two ask
 * for very different things in different languages and grade them against
 * different rules.
 *
 * Shared because none of that varies: a timeout is a timeout.
 */

/**
 * Transport failures are retried separately from content failures.
 *
 * They are different problems and deserve different handling: a timeout or a
 * dropped connection says nothing about the reply and is worth simply trying
 * again, whereas a schema violation needs the specific error echoed back or the
 * model will just repeat it. Collapsing the two meant a transient stall killed
 * the job outright while a fixable content error got two chances.
 */
const TRANSPORT_ATTEMPTS = 2;

export interface ClaudeCallOptions {
  /**
   * How long one call may take.
   *
   * Per module, because the two do different amounts of work. The fact module's
   * call is text in and text out and settles well under a minute; the podcast
   * module's has to read every preview in the backdrop library first, which is
   * minutes rather than seconds. The ceiling stays generous either way - a
   * timeout costs the whole job while a slow call costs only time.
   */
  timeoutMs: number;
  /**
   * Extra CLI arguments, which in practice means tool grants.
   *
   * The default is no tools at all: the model is asked for text and returns
   * text, and granting nothing means there is nothing for an instruction hidden
   * in an input to act with. The podcast module is the exception - it grants
   * `Read` on the library's preview directory, because choosing which
   * photograph belongs under which paragraph requires looking at them.
   */
  extraArgs?: readonly string[];
}

export async function callClaude(
  prompt: string,
  config: AppConfig,
  logger: Logger,
  options: ClaudeCallOptions,
): Promise<string> {
  return withRetry(() => invokeOnce(prompt, config, options), {
    attempts: TRANSPORT_ATTEMPTS,
    initialDelayMs: 2000,
    // Only worth retrying when the problem was reaching the model at all.
    // An exit code carrying a real refusal will repeat, so retrying it just
    // spends minutes to fail the same way.
    shouldRetry: (err) => err instanceof PipelineError && err.code === ERROR_CODES.AI_CALL_FAILED,
    onRetry: (err, attempt, delayMs) =>
      logger.warn(
        `Claude call failed (${err instanceof Error ? err.message : String(err)}); ` +
          `transport retry ${attempt}/${TRANSPORT_ATTEMPTS - 1} in ${delayMs}ms`,
      ),
  });
}

async function invokeOnce(
  prompt: string,
  config: AppConfig,
  options: ClaudeCallOptions,
): Promise<string> {
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
      ...(options.extraArgs && options.extraArgs.length > 0 ? options.extraArgs : ['']),
    ],
    { timeoutMs: options.timeoutMs },
  ).catch((err) => {
    throw new PipelineError(
      ERROR_CODES.AI_CALL_FAILED,
      'generate-storyboard',
      `Could not run "${config.ai.claudeBin}": ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      { cause: err },
    );
  });

  if (result.code !== 0) {
    throw new PipelineError(
      ERROR_CODES.AI_CALL_FAILED,
      'generate-storyboard',
      `Claude exited ${result.code}: ${result.stderr.trim() || result.stdout.slice(0, 400)}`,
    );
  }

  // --output-format json wraps the reply in an envelope; the storyboard is
  // inside .result as a string.
  try {
    const envelope = JSON.parse(result.stdout) as { result?: unknown; is_error?: boolean };
    if (typeof envelope.result === 'string') return envelope.result;
  } catch {
    // Fall through - a plain-text reply is still worth trying to parse.
  }
  return result.stdout;
}

/**
 * Pulls the JSON object out of a reply.
 *
 * Models wrap JSON in prose or fences often enough that demanding a bare object
 * would burn retries on a formatting habit rather than on anything substantive.
 * Brace matching is used rather than a regex so a nested object cannot end the
 * match early.
 */
export function extractJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/u);
  const candidate = fenced?.[1] ?? text;

  const start = candidate.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]!;

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}
