/** One cartoon video, end to end, from a storyboard written by hand. */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { buildTimeline } from '../src/pipeline/build-timeline';
import { buildCaptions } from '../src/modules/shorts/captions';
import { SHORTS_PACING } from '../src/modules/shorts/pacing';
import { StoryboardDraftSchema, checkStoryboardStructure } from '../src/modules/cartoon/domain/storyboard';
import { renderVideo } from '../src/video/renderer';
import { getBundle } from '../src/video/bundler';

const line = (
  id: string, type: string, scenery: string, speaker: string,
  narration: string, cast: unknown[], title = '',
) => ({ id, type, background: scenery, speaker, narration, title, duration: 4, transition: 'cut', cast });

const A = { character: 'meo-van', position: 'trai', pose: 'ngoi', expression: 'binh-thuong' };
const B = { character: 'cho-dom', position: 'phai', pose: 'ngoi', expression: 'binh-thuong' };

const draft = StoryboardDraftSchema.parse({
  version: '1.0',
  project: { id: 'thu-hoat-hinh', episodeTitle: 'Thử hoạt hình' },
  video: { style: 'calm' },
  voice: { voice: 'Phạm Tuyên' },
  content: { summary: 'Bản dựng thử của pipeline hoạt hình.', narration: '' },
  scenes: [
    line('s1', 'intro', 'san-vuon', 'meo-van', 'Ê, mày biết vì sao chó hay quay ba vòng rồi mới nằm không.',
      [{ ...A, expression: 'nghi-ngo' }, { ...B, expression: 'binh-thuong' }], 'Ba vòng'),
    line('s2', 'segment', 'san-vuon', 'cho-dom', 'Tao quay để kiểm tra xem chỗ đó có rắn không, tổ tiên tao dạy thế.',
      [A, { ...B, expression: 'vui' }]),
    line('s3', 'segment', 'san-vuon', 'meo-van', 'Mày đang nằm trên đệm trong nhà đấy, làm gì có rắn.',
      [{ ...A, expression: 'nghi-ngo' }, { ...B, expression: 'ngac-nhien' }]),
    line('s4', 'outro', 'san-vuon', 'cho-dom', 'Thì tao vẫn quay, phòng khi cái đệm nó nuốt tao.',
      [{ ...A, expression: 'buon' }, { ...B, pose: 'nam', expression: 'vui' }]),
  ],
});

const problems = checkStoryboardStructure(draft);
console.log(problems.length ? `LOI CAU TRUC:\n  ${problems.join('\n  ')}` : 'cau truc: sach');
if (problems.length) process.exit(1);

const fps = 30;
const seconds = draft.scenes.length * 3.6;
const { timeline } = buildTimeline({
  storyboard: {
    ...draft,
    video: { width: 1080, height: 1920, fps, targetDuration: seconds, durationMin: 5, durationMax: 90, style: 'calm' },
    voice: { language: 'vi-VN', provider: 'mock', voice: 'Phạm Tuyên', rate: '+0%', pitch: '+0Hz' },
  } as never,
  module: 'fact',
  pacing: SHORTS_PACING,
  coverTolerance: 4,
  buildCaptions: buildCaptions as never,
  backdrops: new Map(),
  stageFor: (scene: never) => ({
    scenery: (scene as { background: string }).background,
    cast: (scene as { cast: [] }).cast,
    speaker: (scene as { speaker: string }).speaker,
  }),
  voiceSrc: null,
  voiceDurationSec: seconds,
  words: [],
  musicSrc: null,
  musicVolume: 0,
  imageSrcFor: () => '',
});

await mkdir('tmp', { recursive: true });
await writeFile('tmp/cartoon-timeline.json', JSON.stringify(timeline, null, 2));
console.log(`timeline: ${timeline.scenes.length} canh, ${timeline.video.durationInFrames} frame`);
console.log('  canh 1 co stage:', JSON.stringify(timeline.scenes[0]!.stage));

const serveUrl = await getBundle();
await renderVideo({ bundleLocation: serveUrl, timeline, outputPath: path.resolve('tmp/cartoon.mp4') } as never);
console.log('-> tmp/cartoon.mp4');
