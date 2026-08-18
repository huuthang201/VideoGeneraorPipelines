import { describe, expect, it, vi } from 'vitest';
import { RETRY_BUDGETS, withRetry } from '../../src/utils/retry';
import { FileCache } from '../../src/utils/cache';

/** Deterministic substitutes so backoff is assertable and tests do not wait. */
const instant = () => Promise.resolve();
const midpoint = () => 0.5;

describe('withRetry', () => {
  it('returns the first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    expect(await withRetry(fn, { attempts: 3, sleep: instant })).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValue('ok');

    expect(await withRetry(fn, { attempts: 3, sleep: instant, random: midpoint })).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('stops at the budget and rethrows the last error', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('still broken'));

    await expect(withRetry(fn, { attempts: 3, sleep: instant, random: midpoint })).rejects.toThrow(
      'still broken',
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('never retries forever', async () => {
    // The budget is the whole point; an unbounded loop against a dead service
    // would hang the queue rather than failing the job.
    const fn = vi.fn().mockRejectedValue(new Error('down'));
    await expect(withRetry(fn, { attempts: 1, sleep: instant })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up immediately when shouldRetry says the error is permanent', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('invalid credentials'));

    await expect(
      withRetry(fn, { attempts: 5, sleep: instant, shouldRetry: () => false }),
    ).rejects.toThrow('invalid credentials');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('backs off exponentially', async () => {
    const delays: number[] = [];
    const fn = vi.fn().mockRejectedValue(new Error('x'));

    await withRetry(fn, {
      attempts: 4,
      initialDelayMs: 100,
      sleep: async (ms) => {
        delays.push(ms);
      },
      random: midpoint,
    }).catch(() => {});

    // With jitter pinned at its midpoint each delay is 0.75x the raw backoff.
    expect(delays).toEqual([75, 150, 300]);
  });

  it('applies jitter so simultaneous failures do not retry in lockstep', async () => {
    const collect = async (random: () => number) => {
      const delays: number[] = [];
      await withRetry(vi.fn().mockRejectedValue(new Error('x')), {
        attempts: 2,
        initialDelayMs: 1000,
        sleep: async (ms) => {
          delays.push(ms);
        },
        random,
      }).catch(() => {});
      return delays[0]!;
    };

    expect(await collect(() => 0)).not.toBe(await collect(() => 1));
  });

  it('honours the ceiling on long backoffs', async () => {
    const delays: number[] = [];
    await withRetry(vi.fn().mockRejectedValue(new Error('x')), {
      attempts: 8,
      initialDelayMs: 1000,
      maxDelayMs: 4000,
      sleep: async (ms) => {
        delays.push(ms);
      },
      random: () => 1,
    }).catch(() => {});

    expect(Math.max(...delays)).toBeLessThanOrEqual(4000);
  });
});

describe('retry budgets', () => {
  it('gives Claude the two attempts spec §55 allows', () => {
    // Deliberately not more: a single call reading three images takes minutes,
    // so extra attempts cost real time rather than buying reliability.
    expect(RETRY_BUDGETS.claude).toBe(2);
  });

  it('gives TTS more than spec §55 budgets, on purpose', () => {
    // A considered deviation. Spec §55 says two, but Vietnamese narration is
    // mandatory (spec §7) and Edge TTS is an unofficial endpoint that answers
    // NoAudioReceived for text it synthesises fine moments later - seen here on
    // a 484-character narration that failed twice and then succeeded unchanged.
    // With two attempts a transient refusal fails the entire job; TTS calls are
    // also seconds rather than minutes, so the extra attempts are cheap.
    expect(RETRY_BUDGETS.tts).toBeGreaterThan(2);
  });

  it('does not retry background removal, which falls back instead', () => {
    expect(RETRY_BUDGETS.backgroundRemoval).toBe(1);
  });

  it('is most persistent about copying output', () => {
    // Cheap to retry and the video is already made by then; losing it to a
    // transient filesystem error would waste the whole run.
    expect(RETRY_BUDGETS.outputCopy).toBe(3);
  });
});

describe('FileCache.key', () => {
  it('is stable and order-independent', () => {
    expect(FileCache.key({ a: '1', b: '2' })).toBe(FileCache.key({ b: '2', a: '1' }));
  });

  it('changes when any input changes', () => {
    const base = { text: 'xin chào', voice: 'vi-VN-HoaiMyNeural', rate: '+5%' };
    const keys = new Set([
      FileCache.key(base),
      FileCache.key({ ...base, text: 'xin chào bạn' }),
      FileCache.key({ ...base, voice: 'vi-VN-NamMinhNeural' }),
      FileCache.key({ ...base, rate: '+0%' }),
    ]);
    expect(keys.size).toBe(4);
  });

  it('treats a missing value differently from a present one', () => {
    expect(FileCache.key({ rate: undefined })).not.toBe(FileCache.key({ rate: '+5%' }));
  });
});
