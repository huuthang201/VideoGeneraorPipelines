/**
 * Error taxonomy. Every failure that reaches 99_ERROR/{id}/error.json (spec §47)
 * carries one of these codes, so failures are greppable and the Claude Code
 * layer can branch on them without parsing prose.
 */
export const ERROR_CODES = {
  // input / validation
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  /** A project is missing a character library, an environment library, or both. */
  MINIMUM_IMAGES_NOT_MET: 'MINIMUM_IMAGES_NOT_MET',
  IMAGE_UNREADABLE: 'IMAGE_UNREADABLE',
  INVALID_INFO_JSON: 'INVALID_INFO_JSON',
  INVALID_STORYBOARD: 'INVALID_STORYBOARD',
  INVALID_TIMELINE: 'INVALID_TIMELINE',

  // ai
  AI_CALL_FAILED: 'AI_CALL_FAILED',
  AI_INVALID_OUTPUT: 'AI_INVALID_OUTPUT',
  AI_FACT_VIOLATION: 'AI_FACT_VIOLATION',

  // tts - narration is mandatory: a job cannot reach DONE without real speech
  TTS_GENERATION_FAILED: 'TTS_GENERATION_FAILED',
  TTS_EMPTY_AUDIO: 'TTS_EMPTY_AUDIO',
  TTS_PYTHON_MISSING: 'TTS_PYTHON_MISSING',

  // images
  IMAGE_PROCESSING_FAILED: 'IMAGE_PROCESSING_FAILED',

  // render
  RENDER_FAILED: 'RENDER_FAILED',
  BUNDLE_FAILED: 'BUNDLE_FAILED',

  // output validation (spec §39)
  OUTPUT_MISSING: 'OUTPUT_MISSING',
  OUTPUT_TOO_SMALL: 'OUTPUT_TOO_SMALL',
  OUTPUT_NO_VIDEO_STREAM: 'OUTPUT_NO_VIDEO_STREAM',
  OUTPUT_NO_AUDIO_STREAM: 'OUTPUT_NO_AUDIO_STREAM',
  /**
   * Remotion emits an AAC track even when the composition has no <Audio> at all
   * (verified during M0 preflight), so "has an audio stream" does not prove the
   * narration made it in. This code covers a track that exists but is silent.
   */
  OUTPUT_SILENT_AUDIO: 'OUTPUT_SILENT_AUDIO',
  OUTPUT_WRONG_RESOLUTION: 'OUTPUT_WRONG_RESOLUTION',
  OUTPUT_BAD_DURATION: 'OUTPUT_BAD_DURATION',
  OUTPUT_UNREADABLE: 'OUTPUT_UNREADABLE',

  // publish
  /**
   * YouTube refused the upload, for any reason of its own.
   *
   * Everything in `publish/youtube.ts` used to throw `AI_CALL_FAILED`, which
   * put "AI" in front of every message about a video the model never touched -
   * so an operator reading `AI_CALL_FAILED at publish` reasonably went looking
   * at Claude. Nothing in publishing calls a model.
   */
  YOUTUBE_UPLOAD_FAILED: 'YOUTUBE_UPLOAD_FAILED',
  /**
   * The channel has hit YouTube's cap on videos per day.
   *
   * Its own code because it is not a fault: nothing is broken, nothing needs
   * fixing, and the only correct response is to wait. Told apart from a real
   * failure it stops an operator debugging a working system - and it is the
   * single most likely refusal on a channel publishing every two hours.
   */
  YOUTUBE_UPLOAD_LIMIT: 'YOUTUBE_UPLOAD_LIMIT',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Pipeline stage names, used for both logging and error.json. */
export type PipelineStage =
  | 'validate'
  | 'process-images'
  | 'generate-storyboard'
  | 'suggest-brief'
  | 'generate-tts'
  | 'generate-captions'
  | 'calculate-timeline'
  | 'build-props'
  | 'render'
  | 'validate-output'
  | 'thumbnail'
  | 'publish';

export class PipelineError extends Error {
  readonly code: ErrorCode;
  readonly stage: PipelineStage;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    stage: PipelineStage,
    message: string,
    details?: Record<string, unknown>,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PipelineError';
    this.code = code;
    this.stage = stage;
    this.details = details;
  }

  /** Shape written to 99_ERROR/{id}/error.json (spec §47). */
  toErrorFile(projectId: string): {
    projectId: string;
    stage: PipelineStage;
    code: ErrorCode;
    message: string;
    timestamp: string;
    details?: Record<string, unknown>;
  } {
    return {
      projectId,
      stage: this.stage,
      code: this.code,
      message: this.message,
      timestamp: new Date().toISOString(),
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function isPipelineError(err: unknown): err is PipelineError {
  return err instanceof PipelineError;
}
