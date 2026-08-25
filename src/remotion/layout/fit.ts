import type { ImageFit } from '../../domain/scene';

/**
 * Image fitting.
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
 * Which treatment suits a given source in a given frame.
 *
 * Decided by comparing the two aspect ratios rather than by naming shapes,
 * because the frame is not always vertical: a landscape photograph is
 * full-bleed in a 16:9 render and would be letterboxed in a 9:16 one, and a
 * rule written in terms of "portrait" or "landscape" gets that exactly
 * backwards half the time.
 *
 * ## Why the tolerance is a parameter
 *
 * How far a source may be from the frame's shape and still be cropped to fill
 * it, rather than contained over a blurred copy of itself. The two modules
 * answer this very differently, and both answers are right for what they show.
 *
 * The **fact module uses 4.0**, which is extremely generous: a 16:9 source
 * fills a 9:16 frame and a 9:16 source fills a 16:9 one, both by cropping
 * heavily, which costs a backdrop nothing. It was 1.35 there and sent an
 * ordinary 16:9 photograph in a vertical frame (ratio 3.16) to the blurred
 * treatment - a short with the photograph reduced to a band across the middle
 * and blurred grey above and below it, which is what a reposted video looks
 * like. Since stock results are mostly landscape, that was every scene of every
 * video.
 *
 * The **podcast module keeps 1.35**, and deliberately. Its frame and its
 * library are both landscape, so the tolerance is rarely exercised at all; when
 * it is, the image is an odd one out, and the interface promises the user that
 * an off-ratio photograph is blurred at the sides rather than cropped into. A
 * ten-minute episode also holds each picture long enough for a hard crop to be
 * studied, which a four-second cut does not.
 */
export function defaultFitFor(
  imageAspect: number,
  frameAspect: number,
  coverTolerance: number,
): ImageFit {
  if (!Number.isFinite(imageAspect) || imageAspect <= 0) return 'blur-pad';
  const ratio = imageAspect / frameAspect;
  return ratio >= 1 / coverTolerance && ratio <= coverTolerance ? 'cover' : 'blur-pad';
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


