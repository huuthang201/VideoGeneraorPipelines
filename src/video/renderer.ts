import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import type { Timeline } from '../domain/timeline';
import { ERROR_CODES, PipelineError } from '../domain/errors';

/**
 * Programmatic rendering.
 *
 * The API is used rather than the CLI so failures arrive as catchable errors
 * with context, instead of an exit code and a wall of stdout to parse.
 */

export const COMPOSITION_ID = 'ShortVideo';

/**
 * How long a `delayRender()` handle may stay open before the render fails.
 *
 * Remotion's default is 30 seconds, which sounds generous until a busy machine
 * meets a cold Chromium: loading the three bundled font faces on the first
 * frame of a fresh bundle has taken longer than that here, failing an entire
 * render attempt for a page that was merely slow to start.
 *
 * Two minutes was not enough either. A twelve-thousand-frame episode opens
 * pages over several minutes rather than all at once, and one that happened to
 * start while the machine was busy blew the font handle at 118s - throwing away
 * a job that had already paid for a Claude call and seven minutes of speech.
 * Five minutes costs nothing when things are healthy (the handle clears in
 * milliseconds) and it is still bounded, so a genuinely broken page fails
 * rather than hanging the queue.
 */
const DELAY_RENDER_TIMEOUT_MS = 300_000;

export interface RenderInput {
  bundleLocation: string;
  timeline: Timeline;
  outputPath: string;
  onProgress?: (progress: { renderedFrames: number; totalFrames: number }) => void;
  /**
   * Parallel Chrome instances.
   *
   * Left to Remotion by default, which picks from the core count. This was
   * pinned at 2 when an episode was 25 seconds long and the difference did not
   * matter; at twelve thousand frames it is minutes of wall clock, and the
   * scratch-space worry that motivated the pin was about a machine that has
   * since been replaced. Set it explicitly to bound memory on a small host.
   */
  concurrency?: number;
}

export interface RenderOutput {
  outputPath: string;
  durationInFrames: number;
  fps: number;
}

export async function renderVideo(input: RenderInput): Promise<RenderOutput> {
  const inputProps = { timeline: input.timeline };

  // The same props must go to both calls: selectComposition runs
  // calculateMetadata, which is where the real duration and dimensions come
  // from. Passing different props here silently renders the wrong length.
  const composition = await selectComposition({
    serveUrl: input.bundleLocation,
    id: COMPOSITION_ID,
    inputProps,
    timeoutInMilliseconds: DELAY_RENDER_TIMEOUT_MS,
  }).catch((err) => {
    throw new PipelineError(
      ERROR_CODES.RENDER_FAILED,
      'render',
      `Could not resolve composition "${COMPOSITION_ID}": ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      { cause: err },
    );
  });

  await mkdir(path.dirname(input.outputPath), { recursive: true });

  try {
    await renderMedia({
      composition,
      serveUrl: input.bundleLocation,
      codec: 'h264',
      audioCodec: 'aac',
      pixelFormat: 'yuv420p',
      crf: 18,
      outputLocation: input.outputPath,
      inputProps,
      ...(input.concurrency ? { concurrency: input.concurrency } : {}),
      timeoutInMilliseconds: DELAY_RENDER_TIMEOUT_MS,
      onProgress: ({ renderedFrames }) =>
        input.onProgress?.({ renderedFrames, totalFrames: composition.durationInFrames }),
    });
  } catch (err) {
    throw new PipelineError(
      ERROR_CODES.RENDER_FAILED,
      'render',
      `Render failed: ${err instanceof Error ? err.message : String(err)}`,
      { outputPath: input.outputPath },
      { cause: err },
    );
  }

  return {
    outputPath: input.outputPath,
    durationInFrames: composition.durationInFrames,
    fps: composition.fps,
  };
}

/**
 * Thumbnail.
 *
 * Rendered as a still from the composition rather than extracted from the
 * encoded video: the frame comes out at full quality with no inter-frame
 * compression artefacts, which matters for something used as a cover image.
 */
export async function renderThumbnail(input: {
  bundleLocation: string;
  timeline: Timeline;
  outputPath: string;
  frame?: number;
}): Promise<string> {
  const inputProps = { timeline: input.timeline };

  const composition = await selectComposition({
    serveUrl: input.bundleLocation,
    id: COMPOSITION_ID,
    inputProps,
    timeoutInMilliseconds: DELAY_RENDER_TIMEOUT_MS,
  });

  // Default to halfway through the hook: past its entry animation, before the
  // first cut.
  const firstScene = input.timeline.scenes[0];
  const fallbackFrame = firstScene ? Math.floor(firstScene.durationInFrames / 2) : 15;
  const frame = Math.min(input.frame ?? fallbackFrame, composition.durationInFrames - 1);

  await mkdir(path.dirname(input.outputPath), { recursive: true });

  await renderStill({
    composition,
    serveUrl: input.bundleLocation,
    output: input.outputPath,
    inputProps,
    frame: Math.max(0, frame),
    imageFormat: 'jpeg',
    jpegQuality: 90,
    timeoutInMilliseconds: DELAY_RENDER_TIMEOUT_MS,
  });

  return input.outputPath;
}
