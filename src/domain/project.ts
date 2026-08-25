import { z } from 'zod';

/**
 * info.json - optional per-project reference material.
 *
 * Almost every video here has none, and that is the expected case. A fact video
 * makes claims, but they are claims about the world - "mật ong không bao giờ
 * hỏng" - which no file in this repository can adjudicate; truthfulness there
 * is fought for in the prompt and by whoever reviews the script. This file
 * exists for the narrower case where a video is about something *commercial*
 * and checkable - a product, a price, a set of figures - and the writer wants
 * those figures to be the only ones that can appear.
 *
 * When it is present it becomes the fact whitelist: Claude may rephrase what is
 * here but may not introduce a number or a claim that is not. `fact-guard.ts`
 * enforces that mechanically, because a prompt instruction alone does not.
 *
 * The schema is strict: an unexpected key is a loud error rather than a value
 * that silently never reaches the model.
 */
export const ProductInfoSchema = z.strictObject({
  /** What the video is about, in a few words. */
  name: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  price: z.union([z.number().nonnegative(), z.string().min(1)]).optional(),
  currency: z.enum(['VND', 'USD']).default('USD').optional(),
  /** Checkable statements the script may draw on, one per entry. */
  features: z.array(z.string().min(1)).default([]).optional(),
  targetAudience: z.array(z.string().min(1)).default([]).optional(),
  cta: z.string().min(1).optional(),
  brand: z.string().min(1).optional(),
  /** Internal note for whoever wrote the file. Never sent to the model as fact. */
  notes: z.string().optional(),
});

export type ProductInfo = z.infer<typeof ProductInfoSchema>;

/**
 * What a picture in this system is.
 *
 * One kind, and it has outlived the library it was named for: an `environment`
 * is a full-frame backdrop photograph, which is the only sort of image a scene
 * has ever contained. Kept as a named constant rather than inlined because
 * `ProcessedImage` is written to disk and read back, and a bare string there
 * would be a value nothing validates.
 */
export const ASSET_KINDS = ['environment'] as const;
export const AssetKindSchema = z.enum(ASSET_KINDS);
export type AssetKind = z.infer<typeof AssetKindSchema>;

export const ORIENTATIONS = ['portrait', 'landscape', 'square'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

/** Output of the Sharp stage. Remotion picks its layout from this. */
export const ProcessedImageSchema = z.strictObject({
  filename: z.string().min(1),
  path: z.string().min(1),
  kind: AssetKindSchema,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  aspectRatio: z.number().positive(),
  orientation: z.enum(ORIENTATIONS),
});

export type ProcessedImage = z.infer<typeof ProcessedImageSchema>;

export interface Project {
  id: string;
  /** Absolute path to runtime/jobs/{id}. The engine never looks outside it. */
  jobDir: string;
  /** Reference material, or null when the video asserts nothing commercial. */
  info: ProductInfo | null;
  images: ProcessedImage[];
}

export const SUPPORTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;

export function classifyOrientation(width: number, height: number): Orientation {
  const ratio = width / height;
  // A 5% dead band around 1.0 keeps near-square crops (very common from phone
  // editing apps) out of the landscape/portrait buckets, where they would get a
  // fit treatment tuned for a shape they do not really have.
  if (ratio > 1.05) return 'landscape';
  if (ratio < 0.95) return 'portrait';
  return 'square';
}

/**
 * What the podcast module's shared library needs before a storyboard can be
 * written.
 *
 * Podcast-only, and here rather than in the module because `AssetKind` and
 * `ProcessedImage` above are shared and these belong beside them. The fact
 * module uploads nothing and never reads these.
 *
 * One backdrop is the honest floor - a scene is a backdrop, so an empty library
 * leaves nothing to draw at all. `COMFORTABLE` is the number below which the
 * result starts to look like a slideshow of the same photograph: a ten minute
 * episode is fifteen to twenty scenes, and reusing four images across those is
 * already pushing it. Falling short of it is a warning, never a refusal - that
 * is a quality judgement and not this layer's call.
 */
export const MINIMUM_ASSETS = {
  environment: 1,
} as const;

export const COMFORTABLE_ENVIRONMENTS = 8;

export interface LibraryCounts {
  environment: number;
}

export function hasEnoughAssets(counts: LibraryCounts): boolean {
  return counts.environment >= MINIMUM_ASSETS.environment;
}
