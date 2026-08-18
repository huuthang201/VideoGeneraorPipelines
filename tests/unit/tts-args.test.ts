import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Regression guard for a defect that silently removed half the delivery range.
 *
 * The synth helper is a Python script driven by argparse. Given `--pitch` and
 * `-10Hz` as two separate arguments, argparse reads the leading minus as the
 * start of another option and aborts with "expected one argument". Every
 * negative pitch or rate - every deeper or slower read - therefore failed,
 * while positive values worked, so the gap was easy to miss.
 *
 * Asserting on the source rather than by spawning Python keeps this fast and
 * keeps it meaningful offline, where Edge TTS cannot be reached anyway.
 */
describe('Edge TTS argument construction', () => {
  const source = readFileSync('src/tts/edge.provider.ts', 'utf8');

  it('passes rate and pitch in the = form so negatives survive', () => {
    expect(source).toMatch(/`--rate=\$\{input\.rate\}`/);
    expect(source).toMatch(/`--pitch=\$\{input\.pitch\}`/);
  });

  it('never pushes them as a separate flag and value', () => {
    expect(source).not.toMatch(/push\('--rate',/);
    expect(source).not.toMatch(/push\('--pitch',/);
  });
});
