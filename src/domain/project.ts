import { z } from 'zod';

/**
 * info.json (spec §5).
 *
 * Every field is optional, but anything present must be well-typed. The schema
 * is strict: an unexpected key is a loud error rather than a value that silently
 * never reaches the model.
 *
 * This object is also the fact whitelist. Claude may rephrase what is here and
 * may judge which photo suits which scene, but may not introduce a price, a
 * spec, a warranty or a promotion that does not appear below. `fact-guard.ts`
 * enforces that mechanically, because a prompt instruction alone does not.
 */
export const ProductInfoSchema = z.strictObject({
  name: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  price: z.union([z.number().nonnegative(), z.string().min(1)]).optional(),
  currency: z.enum(['VND', 'USD']).default('VND').optional(),
  features: z.array(z.string().min(1)).default([]).optional(),
  targetAudience: z.array(z.string().min(1)).default([]).optional(),
  cta: z.string().min(1).optional(),
  brand: z.string().min(1).optional(),
  /** Internal note for whoever wrote the file. Never sent to the model as fact. */
  notes: z.string().optional(),
});

export type ProductInfo = z.infer<typeof ProductInfoSchema>;

export const ORIENTATIONS = ['portrait', 'landscape', 'square'] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

/** Output of the Sharp stage (spec §21). Remotion picks its layout from this. */
export const ProcessedImageSchema = z.strictObject({
  filename: z.string().min(1),
  path: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  aspectRatio: z.number().positive(),
  orientation: z.enum(ORIENTATIONS),
  /** Present only when background removal ran and succeeded (spec §25). */
  cutoutPath: z.string().min(1).nullable().default(null),
});

export type ProcessedImage = z.infer<typeof ProcessedImageSchema>;

export interface Project {
  id: string;
  /** Absolute path to runtime/jobs/{id}. The engine never looks outside it. */
  jobDir: string;
  /** null puts fact-guard in strict mode: no numbers may appear anywhere. */
  info: ProductInfo | null;
  sourceImages: string[];
  images: ProcessedImage[];
}

export const SUPPORTED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;

/** Spec §4: a project is only workable with at least three images. */
export const MINIMUM_IMAGES = 3;

export function classifyOrientation(width: number, height: number): Orientation {
  const ratio = width / height;
  // A 5% dead band around 1.0 keeps near-square crops (very common from phone
  // editing apps) out of the landscape/portrait buckets, where they would get a
  // fit treatment tuned for a shape they do not really have.
  if (ratio > 1.05) return 'landscape';
  if (ratio < 0.95) return 'portrait';
  return 'square';
}
