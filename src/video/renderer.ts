import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import type { Timeline } from '../domain/timeline';
import { ERROR_CODES, PipelineError } from '../domain/errors';

/**
 * Programmatic rendering (spec §37 pipeline step).
 *
 * The API is used rather than the CLI so failures arrive as catchable errors
 * with context, instead of an exit code and a wall of stdout to parse.
 */

export const COMPOSITION_ID = 'ShortVideo';

export interface RenderInput {
  bundleLocation: string;
  timeline: Timeline;
  outputPath: string;
  onProgress?: (progress: { renderedFrames: number; totalFrames: number }) => void;
  /**
   * Parallel Chrome instances. Left conservative by default: each one holds a
   * full 1080x1920 page, and this machine is short on disk for their scratch
   * space.
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
      concurrency: input.concurrency ?? 2,
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
 * Thumbnail (spec §40).
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
  });

  return input.outputPath;
}
