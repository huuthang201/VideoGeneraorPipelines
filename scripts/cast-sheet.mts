/**
 * A contact sheet of every character in every expression.
 *
 * The point is to look at them side by side: an expression only works if it
 * cannot be confused with the one next to it, and that is invisible while you
 * draw them one at a time. The first pass had "vui" and "buồn ngủ" rendering as
 * the same closed arc on the cats - obvious in a grid, invisible in isolation.
 *
 * Rasterised through sharp, from the identical SVG string Remotion renders, so
 * what this shows is what the video shows.
 *
 *   npx tsx scripts/cast-sheet.mts [out.png]
 */
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { CAST, EXPRESSIONS, POSES, characterSvg, VIEWBOX } from '../src/remotion/characters/draw';
import type { CharacterId, Expression, Pose } from '../src/remotion/characters/draw';

/** Which grid to draw: expressions across, or poses across. */
const MODE = (process.argv[3] ?? 'bieu-cam') as 'bieu-cam' | 'tu-the';
const COLS: (Expression | Pose)[] = MODE === 'tu-the' ? POSES : EXPRESSIONS;

const ids = Object.keys(CAST) as CharacterId[];
const CELL = 300;
const cellH = Math.round((CELL / VIEWBOX.w) * VIEWBOX.h);
const PAD = 14;
const W = PAD + COLS.length * (CELL + PAD);
const H = PAD + ids.length * (cellH + PAD);

const layers: sharp.OverlayOptions[] = [];
for (let r = 0; r < ids.length; r++) {
  for (let c = 0; c < COLS.length; c++) {
    const svg = characterSvg({
      id: ids[r]!,
      instance: `${r}${c}`,
      ...(MODE === 'tu-the'
        ? { pose: COLS[c] as Pose, expression: 'vui' as Expression }
        : { expression: COLS[c] as Expression }),
    });
    const png = await sharp(Buffer.from(svg)).resize(CELL, cellH).png().toBuffer();
    layers.push({ input: png, left: PAD + c * (CELL + PAD), top: PAD + r * (cellH + PAD) });
  }
}

await sharp({ create: { width: W, height: H, channels: 4, background: '#232a3a' } })
  .composite(layers)
  .png()
  .toFile(process.argv[2] ?? 'cast-sheet.png');

console.log(`${W}x${H}  ${ids.length} nhan vat x ${COLS.length} ${MODE}`);
console.log('cot:', COLS.join(' | '));
console.log('hang:', ids.map((i) => CAST[i].label).join(' | '));
