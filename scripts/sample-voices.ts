/**
 * Renders the same fact script in several narrator voices, so the choice can be
 * made by ear.
 *
 * A voice name tells you almost nothing, and in this locale it does not even
 * tell you the accent: "Thái Sơn" is southern and "Thanh Bình" is northern,
 * and both are described only as storytelling voices. This writes a clip for
 * each so they can be played back to back and one of them put in TTS_VOICE.
 *
 * The script is a real fact short rather than a neutral sentence, because a
 * voice can fail in two places and only one shows up in a single line:
 * intonation (a hook that has to land, a dash that has to become a pause) and
 * diction. Vietnamese is tonal, so the failure to listen for is not mumbling
 * but a tone landing on the wrong syllable, which turns a word into a
 * different word.
 *
 *   npm run tts:sample                 # the shortlist
 *   npm run tts:sample -- --all        # every voice the engine offers
 *   npm run tts:sample -- "Ngọc Linh" "Minh Đức"
 */
import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { loadConfig } from '../src/config/env';
import { VieNeuTTSProvider, listVieNeuVoices } from '../src/tts/vieneu.provider';
import { EdgeTTSProvider } from '../src/tts/edge.provider';
import { VIETNAMESE_VOICES } from '../src/tts/types';

/** The same passage `npm run tts:pace` measures, so the numbers are comparable. */
const SAMPLE = [
  'Hà mã tiết ra một chất lỏng đỏ cam trên da, khiến người ta tưởng chúng đang đổ mồ hôi máu.',
  'Nhưng đó không phải máu, cũng chẳng phải mồ hôi, mà là một chất nhầy tiết ra từ da chúng,',
  'ban đầu trong suốt nhưng chỉ sau vài phút chuyển sang màu đỏ cam rồi sẫm dần như máu khô.',
  'Chất này hoạt động như một lớp kem chống nắng tự nhiên, đồng thời còn kháng khuẩn [cười].',
].join(' ');

/**
 * The voices worth hearing first, out of nineteen.
 *
 * One male and one female in each of the two accents a Vietnamese audience
 * actually splits on, plus the news reader for contrast. Anyone who wants the
 * central accent or the audiobook styles can pass `--all`.
 */
const SHORTLIST = ['Thái Sơn', 'Thanh Bình', 'Ngọc Linh', 'Trúc Ly', 'Minh Đức'];

// A fact-module tool: it measures the Vietnamese narrator.
const config = loadConfig('fact');
const outDir = path.resolve('runtime', 'voice-samples');

const args = process.argv.slice(2);
const wantAll = args.includes('--all');
const named = args.filter((arg) => !arg.startsWith('--'));

const voices =
  named.length > 0
    ? named
    : config.tts.engine === 'edge'
      ? Object.values(VIETNAMESE_VOICES)
      : wantAll
        ? (await listVieNeuVoices(config.tts.vieneuPythonBin)).map((v) => v.name)
        : SHORTLIST;

await mkdir(outDir, { recursive: true });
console.log(`Engine: ${config.tts.engine}, speed ${config.tts.speed}`);
console.log(`Writing ${voices.length} sample(s) to ${outDir}\n`);

let ok = 0;
for (const voice of voices) {
  const workDir = path.join(outDir, '.work');
  try {
    const provider =
      config.tts.engine === 'edge'
        ? new EdgeTTSProvider(config.tts.pythonBin)
        : new VieNeuTTSProvider(config.tts.vieneuPythonBin, config.tts.speed);

    const result = await provider.synthesize({
      text: SAMPLE,
      language: 'vi-VN',
      voice,
      rate: config.tts.rate,
      pitch: config.tts.pitch,
      volume: config.tts.volume,
      outDir: workDir,
    });

    // Named after the voice so a folder of these is browsable, and the working
    // directory is reused rather than accumulating one per voice.
    const target = path.join(outDir, `${voice.replace(/[^\p{L}\p{N}-]+/gu, '-')}.mp3`);
    await rm(target, { force: true });
    const { rename } = await import('node:fs/promises');
    await rename(result.audioPath, target);

    console.log(`  ${voice.padEnd(14)} ${result.duration.toFixed(1)}s  ${target}`);
    ok++;
  } catch (err) {
    console.log(`  ${voice.padEnd(14)} FAILED: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

console.log(`\n${ok}/${voices.length} rendered. Play them, pick one, set TTS_VOICE in .env.`);
console.log('Then re-measure the pace: npm run tts:pace');
