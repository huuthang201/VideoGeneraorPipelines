/**
 * Error taxonomy. Every failure that reaches 99_ERROR/{id}/error.json (spec §47)
 * carries one of these codes, so failures are greppable and the Claude Code
 * layer can branch on them without parsing prose.
 */
export const ERROR_CODES = {
  // input / validation
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  MINIMUM_IMAGES_NOT_MET: 'MINIMUM_IMAGES_NOT_MET',
  IMAGE_UNREADABLE: 'IMAGE_UNREADABLE',
  INVALID_INFO_JSON: 'INVALID_INFO_JSON',
  INVALID_STORYBOARD: 'INVALID_STORYBOARD',
  INVALID_TIMELINE: 'INVALID_TIMELINE',

  // ai
  AI_CALL_FAILED: 'AI_CALL_FAILED',
  AI_INVALID_OUTPUT: 'AI_INVALID_OUTPUT',
  AI_FACT_VIOLATION: 'AI_FACT_VIOLATION',

  // tts - Vietnamese narration is mandatory (spec §7, §15)
  TTS_GENERATION_FAILED: 'TTS_GENERATION_FAILED',
  TTS_EMPTY_AUDIO: 'TTS_EMPTY_AUDIO',
  TTS_PYTHON_MISSING: 'TTS_PYTHON_MISSING',

  // images
  IMAGE_PROCESSING_FAILED: 'IMAGE_PROCESSING_FAILED',
  /** A b-roll prompt would have depicted the product or an unsourced claim. */
  IMAGE_PROMPT_REJECTED: 'IMAGE_PROMPT_REJECTED',
  IMAGE_GENERATION_UNAVAILABLE: 'IMAGE_GENERATION_UNAVAILABLE',

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
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Pipeline stage names, used for both logging and error.json. */
export type PipelineStage =
  | 'validate'
  | 'process-images'
  | 'generate-storyboard'
  | 'suggest-brief'
  | 'generate-broll'
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
