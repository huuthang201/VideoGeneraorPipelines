import type { ImageFit } from '../../domain/scene';
import type { Orientation } from '../../domain/project';

/**
 * Image fitting for a 9:16 frame (spec §22-23).
 *
 * The single rule that matters: never stretch. The classic way this goes wrong
 * is setting both width:100% and height:100% on an <img> and letting the
 * browser squash it, so nothing here ever emits a percentage pair - every
 * result is an explicit pixel box computed from the source aspect ratio.
 */

export interface FitBox {
  /** Rendered width in px. Always imageWidth * scale. */
  width: number;
  /** Rendered height in px. Always imageHeight * scale. */
  height: number;
  /** Uniform scale factor applied to the source. Never differs per axis. */
  scale: number;
  /** Offset from frame origin to place the box centred, in px. */
  left: number;
  top: number;
}

export interface FitResult {
  mode: ImageFit;
  /** The sharp, correctly-proportioned image. */
  foreground: FitBox;
  /**
   * Present only for 'blur-pad': a cover-scaled copy of the same image sitting
   * behind the foreground, blurred, so the frame is filled without bars and
   * without cropping the product.
   */
  background: FitBox | null;
}

/**
 * Which treatment suits a given source shape (spec §23).
 *
 * Portrait already matches the frame closely enough that cover crops very
 * little, so it gets the full-bleed treatment. Landscape and square would lose
 * too much of the product to a 9:16 crop, so they are contained over a blurred
 * copy of themselves instead.
 */
export function defaultFitFor(orientation: Orientation): ImageFit {
  return orientation === 'portrait' ? 'cover' : 'blur-pad';
}

export function coverScale(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
): number {
  return Math.max(frameWidth / imageWidth, frameHeight / imageHeight);
}

export function containScale(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
): number {
  return Math.min(frameWidth / imageWidth, frameHeight / imageHeight);
}

function boxFor(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
  scale: number,
): FitBox {
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    width,
    height,
    scale,
    left: (frameWidth - width) / 2,
    top: (frameHeight - height) / 2,
  };
}

/**
 * How much of the frame height the contained foreground is allowed to occupy in
 * blur-pad mode. Held below 1 so the blurred backdrop stays visible as a frame
 * rather than being completely hidden behind the product.
 */
const BLUR_PAD_FOREGROUND_INSET = 0.86;

export function computeFit(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
  mode: ImageFit,
): FitResult {
  if (imageWidth <= 0 || imageHeight <= 0) {
    throw new Error(`Invalid image dimensions: ${imageWidth}x${imageHeight}`);
  }
  if (frameWidth <= 0 || frameHeight <= 0) {
    throw new Error(`Invalid frame dimensions: ${frameWidth}x${frameHeight}`);
  }

  if (mode === 'cover') {
    const scale = coverScale(imageWidth, imageHeight, frameWidth, frameHeight);
    return {
      mode,
      foreground: boxFor(imageWidth, imageHeight, frameWidth, frameHeight, scale),
      background: null,
    };
  }

  if (mode === 'contain') {
    const scale = containScale(imageWidth, imageHeight, frameWidth, frameHeight);
    return {
      mode,
      foreground: boxFor(imageWidth, imageHeight, frameWidth, frameHeight, scale),
      background: null,
    };
  }

  const inset = BLUR_PAD_FOREGROUND_INSET;
  const foregroundScale = containScale(
    imageWidth,
    imageHeight,
    frameWidth * inset,
    frameHeight * inset,
  );
  const backgroundScale = coverScale(imageWidth, imageHeight, frameWidth, frameHeight);

  return {
    mode,
    foreground: boxFor(imageWidth, imageHeight, frameWidth, frameHeight, foregroundScale),
    background: boxFor(imageWidth, imageHeight, frameWidth, frameHeight, backgroundScale),
  };
}

/** True when the box covers the whole frame - i.e. no bars will show. */
export function coversFrame(box: FitBox, frameWidth: number, frameHeight: number): boolean {
  // Tolerate sub-pixel rounding; a 0.5px gap is not a visible bar.
  const epsilon = 1;
  return box.width >= frameWidth - epsilon && box.height >= frameHeight - epsilon;
}

/** The source aspect ratio, for asserting in tests that nothing got squashed. */
export function boxAspectRatio(box: FitBox): number {
  return box.width / box.height;
}
