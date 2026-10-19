/**
 * One frame of the cartoon stage, rendered through Remotion itself.
 *
 * Not a preview of the drawing - a preview of the *composition*: the same
 * bundler, the same browser and the same layout the finished video uses, so
 * what it shows about size and placement is true. Both sizing bugs this file
 * caught were invisible in the contact sheet, because a contact sheet has no
 * frame to overflow.
 *
 *   npx tsx scripts/stage-still.mts out.png '{"background":"xanh-den",...}' [frame]
 */
import { renderStill, selectComposition } from '@remotion/renderer';
import { getBundle } from '../src/video/bundler';

const out = process.argv[2] ?? 'stage.png';
const props = JSON.parse(process.argv[3] ?? '{}');

const serveUrl = await getBundle();
const composition = await selectComposition({ serveUrl, id: 'CartoonStage', inputProps: props });
await renderStill({
  serveUrl,
  composition,
  output: out,
  inputProps: props,
  frame: Number(process.argv[4] ?? 3),
});
console.log('->', out);
