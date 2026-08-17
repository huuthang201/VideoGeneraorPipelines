/**
 * Background removal (spec §25). Optional in V1 and off by default.
 *
 * The contract is unusual on purpose: an implementation must never throw for a
 * removal that simply did not work. Spec §25 is explicit that a failure here
 * falls back to the original image rather than failing the video, so the
 * interface returns a path either way and callers cannot forget to handle it.
 */
export interface BackgroundRemovalProvider {
  readonly name: string;
  readonly enabled: boolean;
  /** Returns the cutout path on success, or the input path on any failure. */
  removeBackground(imagePath: string, outPath: string): Promise<string>;
}

/**
 * The default. Does nothing and says so.
 *
 * Having an explicit no-op rather than a nullable provider means the pipeline
 * has one code path whether or not the feature is on, so the disabled case is
 * exercised by every run instead of being a branch nobody tests.
 */
export class NoopBackgroundRemovalProvider implements BackgroundRemovalProvider {
  readonly name = 'noop';
  readonly enabled = false;

  async removeBackground(imagePath: string): Promise<string> {
    return imagePath;
  }
}
