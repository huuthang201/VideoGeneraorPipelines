/** One word with its measured timing. */
export interface WordTiming {
  text: string;
  fromMs: number;
  toMs: number;
}

export interface TTSInput {
  text: string;
  /** BCP-47 tag, e.g. "vi-VN". Carried for the record; the voice implies it. */
  language: string;
  voice: string;
  /** Edge-style relative rate, e.g. "+8%". */
  rate?: string;
  /** Edge-style pitch offset, e.g. "+0Hz". */
  pitch?: string;
  /**
   * Edge-style volume offset, e.g. "+0%".
   *
   * The third delivery knob, and the one that changes presence rather than
   * pace: a few decibels either way makes a voice lean in or step back without
   * touching how fast it reads.
   */
  volume?: string;
  /** Directory to write voice.mp3 and captions.srt into. */
  outDir: string;
}

export interface TTSResult {
  audioPath: string;
  captionsPath: string;
  /**
   * Real container duration in seconds, measured with ffprobe - never an
   * estimate. A job may not reach DONE when this is <= 0.
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

/**
 * The narrators.
 *
 * Short rather than curated: Microsoft's Vietnamese locale offers exactly two
 * voices, and one of them is male. These videos are narrated by a northern
 * Vietnamese man, so `namMinh` is the voice and `hoaiMy` is what a channel
 * would switch to if it wanted a woman reading instead.
 *
 * Both are Hanoi-accented - the service publishes no southern Vietnamese
 * voice at all, which is worth knowing before anyone goes looking for one in
 * `npm run tts:voices`.
 *
 * A word of warning that applies to both: they are read-aloud voices, so
 * everything they do with pitch and pause comes from the script's punctuation.
 * See the writing rules in the storyboard prompt.
 */
export const VIETNAMESE_VOICES = {
  /** Male, northern. The default: level, clear, and takes a fact seriously. */
  namMinh: 'vi-VN-NamMinhNeural',
  /** Female, northern. The only alternative the locale has. */
  hoaiMy: 'vi-VN-HoaiMyNeural',
} as const;

/**
 * The narrator shortlist for the podcast module: young, and with some life in
 * the read.
 *
 * Not a whitelist - TTS_VOICE accepts any Edge voice name, and `npm run
 * tts:voices` lists them all. This is the set worth listening to, and it is
 * chosen from the service's own metadata rather than from the names: every
 * voice it returns carries a personality tag, and only a handful of English
 * female voices are tagged anything other than the default "Friendly,
 * Positive". Those few are what this list is.
 *
 * The comment beside each is the service's tag, not an opinion - so if a voice
 * sounds wrong for an episode, the tag says what it was built for.
 *
 * A warning that matters over ten minutes: the tags describe a sentence, not an
 * episode. "Cute" is delightful for thirty seconds and can wear thin over a
 * long one, which is why `npm run tts:sample` reads a whole paragraph rather
 * than a line - judge them on that.
 */
export const ENGLISH_VOICES = {
  /** News, Novel - Positive, Confident. The default: the storytelling register. */
  aria: 'en-US-AriaNeural',
  /** News, Novel - Friendly, Pleasant. Aria's nearest neighbour, a shade warmer. */
  michelle: 'en-US-MichelleNeural',
  /** Conversation - Cheerful, Clear, Conversational. */
  emmaMultilingual: 'en-US-EmmaMultilingualNeural',
  /** Conversation - Expressive, Caring, Pleasant, Friendly. */
  avaMultilingual: 'en-US-AvaMultilingualNeural',
  /** The same two characters, single-language builds. */
  emma: 'en-US-EmmaNeural',
  ava: 'en-US-AvaNeural',
  /** Friendly, Considerate, Comfort. */
  jenny: 'en-US-JennyNeural',
  /** The youngest-sounding British adult voice. */
  libby: 'en-GB-LibbyNeural',
  /** Clear British, older-sounding until the pitch is lifted. */
  sonia: 'en-GB-SoniaNeural',
  /** Irish, young and lilting. */
  emily: 'en-IE-EmilyNeural',
  /** Singapore English, light and young. */
  luna: 'en-SG-LunaNeural',
  /**
   * Cartoon - Cute. A genuine child voice, and the reason this list carries
   * notes at all: it is the obvious pick from the name and the wrong one in
   * practice, because its consonants blur over anything longer than a line.
   */
  ana: 'en-US-AnaNeural',
} as const;

/**
 * BCP-47 tag implied by a voice name, for the record kept in storyboard.json.
 *
 * `fallback` is what an unprefixed name resolves to, and it has to be passed in
 * because the two modules read the same absence differently: a VieNeu preset is
 * called "Thanh Bình" and is Vietnamese, while an Edge voice always carries its
 * locale, so an unprefixed name in the podcast module means something has gone
 * wrong rather than that a local engine is in use.
 */
export function languageOf(voice: string, fallback = 'vi-VN'): string {
  const match = voice.match(/^([a-z]{2}-[A-Z]{2})-/u);
  return match?.[1] ?? fallback;
}

/**
 * Whether a voice belongs to the English locale.
 *
 * The podcast module's counterpart to `isVietnameseVoice`, and it exists for
 * the mirror-image reason: the service's multilingual voices from other locales
 * read English perfectly well, with their own colour. They were auditioned and
 * ruled out, so this refuses a non-`en-` voice before TTS runs rather than
 * after a whole episode has been spoken in it.
 */
export function isEnglishVoice(voice: string): boolean {
  const match = voice.match(/^([a-z]{2})-[A-Z]{2}-/u);
  return match === null || match[1] === 'en';
}

/**
 * Whether a voice belongs to the Vietnamese locale.
 *
 * The scripts are written in Vietnamese, so the narrator has to be. The check
 * exists because the alternative is available and tempting: the service has
 * multilingual voices from other locales that will happily read Vietnamese
 * text, and what comes out is a foreigner reading phonetically - wrong tones,
 * wrong everything. It is also the failure that is cheapest to prevent and
 * most expensive to discover, since it is only audible once a whole video has
 * been spoken and rendered.
 *
 * A voice name that is not locale-prefixed at all (some engines use plain ids)
 * passes: this rules out the wrong locale, not every naming scheme.
 */
export function isVietnameseVoice(voice: string): boolean {
  const match = voice.match(/^([a-z]{2})-[A-Z]{2}-/u);
  return match === null || match[1] === 'vi';
}
