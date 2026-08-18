/**
 * Retry with exponential backoff and jitter (spec §55).
 *
 * Budgets differ per stage because the failures differ in kind. A transient
 * Edge TTS rejection is worth retrying; a malformed storyboard is not worth
 * retrying blindly, which is why the AI provider does its own retry loop that
 * feeds the specific violation back rather than repeating the same request.
 */

export interface RetryOptions {
  attempts: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Return false to give up immediately - some failures will never succeed. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** Injectable for tests, so a backoff test does not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests; jitter otherwise makes delays unassertable. */
  random?: () => number;
}

/** Per-stage budgets from spec §55. */
export const RETRY_BUDGETS = {
  claude: 2,
  /**
   * Edge TTS gets more attempts than anything else, and slower ones.
   *
   * It is an unofficial endpoint that intermittently answers with
   * NoAudioReceived for text it will happily synthesise a moment later -
   * observed here on a 484-character narration that failed twice and then
   * succeeded unchanged. Since Vietnamese narration is mandatory (spec §7),
   * a transient refusal otherwise fails the whole job.
   */
  tts: 4,
  render: 2, // one render plus the single retry spec §55 allows
  backgroundRemoval: 1, // no retry; the provider falls back to the original
  outputCopy: 3,
} as const;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const attempts = Math.max(1, options.attempts);
  const initialDelay = options.initialDelayMs ?? 1000;
  const maxDelay = options.maxDelayMs ?? 15_000;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      const isLast = attempt === attempts;
      if (isLast) break;
      if (options.shouldRetry && !options.shouldRetry(err, attempt)) break;

      // Jitter matters even for a single-user tool: without it, two projects
      // that fail at the same moment retry in lockstep and hit the same
      // rate limit together.
      const backoff = Math.min(maxDelay, initialDelay * 2 ** (attempt - 1));
      const delay = Math.round(backoff * (0.5 + random() * 0.5));

      options.onRetry?.(err, attempt, delay);
      await sleep(delay);
    }
  }

  throw lastError;
}
