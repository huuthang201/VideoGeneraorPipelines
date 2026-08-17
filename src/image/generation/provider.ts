/**
 * AI image generation - interface only, no implementation in V1 (spec §26).
 *
 * Declared now so that adding a backend later (FLUX.2 Klein is the candidate)
 * is a new file rather than a change to the pipeline's shape. Nothing in V1
 * calls this, and no model is installed.
 *
 * Note the intended scope: generating *backgrounds* and lifestyle context
 * around a real product photo. Spec §26 is explicit that the product itself
 * should not be redrawn - a synthesised product is a misrepresentation of what
 * the buyer receives, whatever it does for the click-through rate.
 */
export interface ImageGenerationProvider {
  readonly name: string;

  generateBackground(input: {
    prompt: string;
    width: number;
    height: number;
    outPath: string;
  }): Promise<string>;
}
