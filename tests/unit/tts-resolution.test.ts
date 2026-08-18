import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Guards two defects that shipped together and hid each other.
 *
 * Both lived at a single call site - the one place that actually invokes the
 * synthesiser - while everything around it looked correct:
 *
 *   1. The voice was read from `storyboard.voice.voice` rather than config.
 *      Claude writes the default voice into the storyboard when it generates
 *      one, so from then on editing TTS_VOICE rebuilt the video, reported
 *      success, and produced identical narration.
 *
 *   2. `pitch` was never passed at all. It was threaded through the config,
 *      the schema, the provider and the cache key, so every layer agreed on the
 *      value - and none of it reached Edge TTS.
 *
 * The cache made both worse: its key recorded the *requested* voice and pitch,
 * so entries were stored under keys describing audio they did not contain.
 *
 * Asserting on source text is blunt, but the alternative is spawning Claude and
 * Edge TTS for an end-to-end run, and these are exactly the mistakes that
 * survive a passing test suite.
 */
describe('TTS parameter resolution', () => {
  const source = readFileSync('src/pipeline/video-pipeline.ts', 'utf8');

  /** Comments are stripped so prose about a mistake cannot look like the mistake. */
  const withoutComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const synthesizeCall = withoutComments(
    source.match(/provider\.synthesize\(\{[\s\S]*?\}\)/)?.[0] ??
      (() => {
        throw new Error('Could not find the provider.synthesize call');
      })(),
  );

  it('passes the resolved voice, not the storyboard field', () => {
    expect(synthesizeCall).toMatch(/^\s*voice,$/m);
    expect(synthesizeCall).not.toContain('storyboard.voice.voice');
  });

  it('passes pitch through to the synthesiser', () => {
    expect(synthesizeCall).toMatch(/^\s*pitch,$/m);
  });

  it('passes rate through to the synthesiser', () => {
    expect(synthesizeCall).toMatch(/^\s*rate,$/m);
  });

  it('resolves the voice from config, with an explicit override taking priority', () => {
    expect(source).toMatch(/const voice = args\.voiceOverride \?\? config\.tts\.voice;/);
  });

  it('keys the cache on every value that changes how the audio sounds', () => {
    // A key that omits any of these returns audio that does not match what was
    // asked for - the failure mode is silent, and indistinguishable from the
    // setting having no effect.
    const cacheKey = source.match(/FileCache\.key\(\{[\s\S]*?\}\)/)?.[0] ?? '';
    for (const field of ['voice', 'rate', 'pitch', 'text', 'provider']) {
      expect(cacheKey).toContain(field);
    }
  });
});
