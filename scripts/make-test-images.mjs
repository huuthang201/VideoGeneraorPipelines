/**
 * Generates the three test images the sample timeline is drawn on.
 *
 * Each one carries a perfect circle and a square grid. That is the point: a
 * circle can only stay circular under a uniform scale, so if any fit mode ever
 * squashes an image the rendered frame shows an ellipse and the bug is visible
 * at a glance rather than hiding behind "looks about right".
 *
 * Run: node scripts/make-test-images.mjs
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

// The repo-root `public` folder, because that is the one Remotion serves
// staticFile() from - a `public` directory next to the entry point is not
// picked up, and the images silently 404 in Studio if they are written there.
const OUT_DIR = path.join(process.cwd(), 'public', 'test-images');

const SHAPES = [
  { name: 'portrait', width: 1080, height: 1920, bg: '#1d3557', accent: '#e63946' },
  { name: 'landscape', width: 1600, height: 1200, bg: '#2a9d8f', accent: '#e9c46a' },
  { name: 'square', width: 1400, height: 1400, bg: '#5f0f40', accent: '#fb8b24' },
];

function svgFor({ width, height, bg, accent, name }) {
  const radius = Math.min(width, height) * 0.3;
  const cx = width / 2;
  const cy = height / 2;
  const step = Math.min(width, height) / 10;

  const gridLines = [];
  for (let x = 0; x <= width; x += step) {
    gridLines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>`);
  }
  for (let y = 0; y <= height; y += step) {
    gridLines.push(`<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="rgba(255,255,255,0.18)" stroke-width="2"/>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="${width}" height="${height}" fill="${bg}"/>
  ${gridLines.join('\n  ')}
  <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${accent}" stroke-width="14"/>
  <circle cx="${cx}" cy="${cy}" r="${radius * 0.5}" fill="${accent}" opacity="0.85"/>
  <text x="${cx}" y="${cy + radius + 90}" font-family="sans-serif" font-size="${Math.min(width, height) * 0.07}"
        fill="#ffffff" text-anchor="middle" font-weight="bold">${name} ${width}x${height}</text>
</svg>`;
}

await mkdir(OUT_DIR, { recursive: true });

for (const shape of SHAPES) {
  const outPath = path.join(OUT_DIR, `${shape.name}.jpg`);
  await sharp(Buffer.from(svgFor(shape))).jpeg({ quality: 90 }).toFile(outPath);
  console.log(`wrote ${outPath} (${shape.width}x${shape.height})`);
}
