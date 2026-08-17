/** One word (in Vietnamese, effectively one syllable) with its measured timing. */
export interface WordTiming {
  text: string;
  fromMs: number;
  toMs: number;
}

export interface TTSInput {
  text: string;
  language: 'vi-VN';
  voice: string;
  /** Edge-style relative rate, e.g. "+5%". */
  rate?: string;
  /** Directory to write voice.mp3 and captions.srt into. */
  outDir: string;
}

export interface TTSResult {
  audioPath: string;
  captionsPath: string;
  /**
   * Real container duration in seconds, measured with ffprobe - never an
   * estimate. Spec §15 forbids a job reaching DONE when this is <= 0.
   */
  duration: number;
  /**
   * Word timings, the input to both caption pages and scene alignment.
   * Empty means the provider could not produce them, which downstream code
   * must treat as a degraded (but not fatal) result.
   */
  words: WordTiming[];
  /** True when the audio is a placeholder rather than real speech. */
  isMock: boolean;
  voice: string;
}

export interface TTSProvider {
  readonly name: string;
  synthesize(input: TTSInput): Promise<TTSResult>;
}

/** Voices from spec §13. */
export const VIETNAMESE_VOICES = {
  female: 'vi-VN-HoaiMyNeural',
  male: 'vi-VN-NamMinhNeural',
} as const;

export const DEFAULT_VOICE = VIETNAMESE_VOICES.female;

export function isVietnameseVoice(voice: string): boolean {
  return voice.startsWith('vi-VN-');
}
