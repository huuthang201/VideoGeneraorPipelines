/**
 * Measures how fast the configured narrator actually reads, in words per
 * minute.
 *
 * Run this after changing TTS_VOICE, TTS_SPEED or TTS_RATE, and put the answer
 * in WORDS_PER_MINUTE (src/domain/config.ts). Nothing else keeps the two in
 * step: that constant turns "forty-five seconds" into a word budget for the
 * prompt, so a stale value does not fail anything - it silently produces videos
 * of the wrong length, which at this format means videos that overrun sixty
 * seconds and stop being Shorts.
 *
 * Two things move the number more than people expect, and both are why this
 * exists rather than a table in a README:
 *
 * - **The voice.** Thái Sơn tells a story and Thanh Bình reads it; on the same
 *   text they differ by about a quarter.
 * - **The punctuation.** The engine pauses at a full stop and barely at a
 *   comma, so a script of short sentences reads far slower than the same words
 *   written as linked clauses. Measure on a real script, never on prose.
 *
 *   npm run tts:pace                       # the built-in sample script
 *   npm run tts:pace -- path/to/script.txt # a real narration.txt
 */
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EdgeTTSProvider } from '../src/tts/edge.provider';
import { VieNeuTTSProvider } from '../src/tts/vieneu.provider';
import { loadConfig } from '../src/config/env';
import { countWords } from '../src/domain/storyboard';

/** The same passage `npm run tts:sample` reads, for comparable numbers. */
const SAMPLE = [
  'Hà mã tiết ra một chất lỏng đỏ cam trên da, khiến người ta tưởng chúng đang đổ mồ hôi máu.',
  'Nhưng đó không phải máu, cũng chẳng phải mồ hôi, mà là một chất nhầy tiết ra từ da chúng,',
  'ban đầu trong suốt nhưng chỉ sau vài phút chuyển sang màu đỏ cam rồi sẫm dần như máu khô.',
  'Chất này hoạt động như một lớp kem chống nắng tự nhiên, hấp thụ ánh sáng để bảo vệ làn da',
  'trần của hà mã, đồng thời còn kháng khuẩn, giúp những vết thương ngoài da ít bị nhiễm trùng hơn.',
].join(' ');

// A fact-module tool: it measures the Vietnamese narrator.
const config = loadConfig('fact');
const scriptPath = process.argv[2];
const text = scriptPath ? (await readFile(scriptPath, 'utf8')).trim() : SAMPLE;
const words = countWords(text);

/*
 * Which knob to sweep depends on the engine, because they do not have the same
 * one. VieNeu takes no rate at all - its pace comes from the voice, and the
 * only control is the time stretch applied afterwards. Edge takes a rate during
 * synthesis and is left alone by the stretch.
 */
const isVieNeu = config.tts.engine === 'vieneu';
const settings = isVieNeu
  ? [config.tts.speed, 1, 1.3].filter((v, i, all) => all.indexOf(v) === i)
  : [config.tts.rate, '+0%', '+15%'].filter((v, i, all) => all.indexOf(v) === i);

const outDir = await mkdtemp(path.join(tmpdir(), 'pace-'));

console.log(
  `${config.tts.engine} · ${config.tts.voice} · ${words} words` +
    `${isVieNeu ? '' : `, pitch ${config.tts.pitch}`}\n`,
);

try {
  for (const setting of settings) {
    const provider = isVieNeu
      ? new VieNeuTTSProvider(config.tts.vieneuPythonBin, setting as number)
      : new EdgeTTSProvider(config.tts.pythonBin);

    const result = await provider.synthesize({
      text,
      language: 'vi-VN',
      voice: config.tts.voice,
      rate: isVieNeu ? undefined : (setting as string),
      pitch: config.tts.pitch,
      volume: config.tts.volume,
      outDir: path.join(outDir, String(setting).replace(/[^\w.]/g, '')),
    });

    const wpm = Math.round(words / (result.duration / 60));
    const label = isVieNeu ? `speed=${setting}` : `rate=${setting}`;
    const configured =
      setting === (isVieNeu ? config.tts.speed : config.tts.rate)
        ? `   <- configured (${isVieNeu ? 'TTS_SPEED' : 'TTS_RATE'})`
        : '';

    console.log(
      `  ${label.padEnd(12)} ${result.duration.toFixed(1)}s  ->  ${wpm} wpm${configured}`,
    );
  }
} finally {
  await rm(outDir, { recursive: true, force: true });
}

console.log('\nPut the configured line into WORDS_PER_MINUTE in src/domain/config.ts.');
