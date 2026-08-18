/**
 * Where finished videos go (spec §50).
 *
 * The engine deliberately does not know what Google Drive is. It knows it has
 * somewhere to publish to, and in V1 that somewhere is a folder on disk - which
 * is either a plain local directory or a Drive-synced one, a distinction the
 * engine never has to care about. Swapping in the Drive API or S3 later means
 * writing a new implementation of this interface, not touching the pipeline.
 */
export interface PublishTarget {
  /** Human-readable destination, for logs and for the job record. */
  readonly describe: string;
}

export interface StorageProvider {
  readonly name: string;

  /** Projects waiting in the input area, by id. */
  listPending(): Promise<string[]>;

  /** Absolute path to a project's source folder, or null when absent. */
  resolveInput(projectId: string): Promise<string | null>;

  /** Copies a finished output directory to the published location. */
  publish(projectId: string, outputDir: string): Promise<PublishTarget>;

  /** True when this project already has a published video. */
  isPublished(projectId: string): Promise<boolean>;

  /** Records a failure where the operator will look for it (spec §47). */
  reportError(projectId: string, error: unknown): Promise<void>;

  /** Removes a previously reported failure once the project succeeds. */
  clearError(projectId: string): Promise<void>;
}
