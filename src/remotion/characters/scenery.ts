/**
 * Where a scene happens, drawn rather than photographed.
 *
 * These replace the flat colours. A flat backdrop was fine for an explainer -
 * nothing behind the character competes with the subtitle - but this channel is
 * comedy, and comedy needs a *place*: the joke about a dog at the riverbank is
 * not the same joke on a grey rectangle.
 *
 * Three rules hold all six together, and they are what stop a backdrop turning
 * into visual noise:
 *
 * **The horizon is always at `HORIZON`.** Characters stand at a fixed fraction
 * of the frame, so the ground plane has to meet them at the same height in
 * every scene or they float. One constant, six backdrops.
 *
 * **Everything recedes.** Low contrast, low saturation, and darker as it goes
 * back. The cast is the only thing in the frame allowed to be bright - a
 * backdrop that competes is a backdrop that wins, because it is bigger.
 *
 * **No detail below the horizon.** The ground is nearly plain: it is where the
 * feet, the contact shadows and eventually the subtitle all land, and pattern
 * there fights all three.
 */

export type SceneryId =
  | 'phong-khach'
  | 'san-vuon'
  | 'bo-song'
  | 'duoi-cay'
  | 'duong-pho'
  | 'ban-dem';

export const SCENERY_IDS: SceneryId[] = [
  'phong-khach',
  'san-vuon',
  'bo-song',
  'duoi-cay',
  'duong-pho',
  'ban-dem',
];

export const SCENERY_LABELS: Record<SceneryId, string> = {
  'phong-khach': 'Phòng khách trong nhà',
  'san-vuon': 'Sân vườn, ban ngày',
  'bo-song': 'Bờ sông',
  'duoi-cay': 'Dưới gốc cây',
  'duong-pho': 'Đường phố',
  'ban-dem': 'Ngoài trời ban đêm',
};

export const FRAME = { w: 1080, h: 1920 };

/** Must match `FLOOR_RATIO` in Stage.tsx: it is the same floor. */
const HORIZON = Math.round(FRAME.h * 0.75);

/** Ground plane plus the soft darkening that sits the cast into it. */
function floor(top: string, bottom: string): string {
  return `
    <rect x="0" y="${HORIZON}" width="${FRAME.w}" height="${FRAME.h - HORIZON}" fill="${bottom}"/>
    <rect x="0" y="${HORIZON}" width="${FRAME.w}" height="140" fill="${top}" opacity="0.55"/>
    <ellipse cx="${FRAME.w / 2}" cy="${HORIZON + 30}" rx="${FRAME.w * 0.7}" ry="120" fill="#000" opacity="0.10"/>`;
}

/**
 * Two clouds, and only two.
 *
 * A 9:16 sky is a very large empty area and reads as unfinished with nothing in
 * it - but clouds are also the easiest thing in the frame to overdo, and a busy
 * sky above a subtitle is noise. Two, low contrast, well apart.
 */
function clouds(fill: string, opacity: number): string {
  const puff = (cx: number, cy: number, r: number) =>
    `<ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 0.62}" fill="${fill}"/>`;
  return `
    <g opacity="${opacity}">
      ${puff(230, 340, 96)}${puff(320, 330, 72)}${puff(150, 356, 62)}
      ${puff(700, 620, 74)}${puff(770, 612, 56)}${puff(640, 632, 48)}
    </g>`;
}

function sky(from: string, to: string): string {
  return `
    <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
    </linearGradient></defs>
    <rect x="0" y="0" width="${FRAME.w}" height="${HORIZON}" fill="url(#sky)"/>`;
}

const SCENERY: Record<SceneryId, () => string> = {
  /** Indoors: a wall, a window with evening light, a sofa the cast sits in front of. */
  'phong-khach': () => `
    <rect x="0" y="0" width="${FRAME.w}" height="${HORIZON}" fill="#5a5175"/>
    <rect x="0" y="${HORIZON - 300}" width="${FRAME.w}" height="300" fill="#4e4667"/>
    <!-- Daylight through the window. Without it the room reads as a power cut:
         an interior needs a light source or every surface is the same murk. -->
    <rect x="130" y="500" width="380" height="440" rx="20" fill="#6d648c"/>
    <rect x="154" y="524" width="332" height="392" rx="12" fill="#b9d3e4"/>
    <rect x="308" y="524" width="24" height="392" fill="#6d648c"/>
    <rect x="154" y="702" width="332" height="20" fill="#6d648c"/>
    <path d="M 154 916 L 486 916 L 700 ${HORIZON + 90} L 60 ${HORIZON + 90} Z"
          fill="#dbe6f0" opacity="0.10"/>
    <!-- Sofa, kept as a silhouette: furniture in focus steals the frame. -->
    <rect x="600" y="${HORIZON - 300}" width="440" height="300" rx="34" fill="#584f74"/>
    <rect x="634" y="${HORIZON - 248}" width="372" height="248" rx="24" fill="#6a608a"/>
    ${floor('#463d5c', '#3b3450')}`,

  'san-vuon': () => `
    ${sky('#5c7fa8', '#9fb9cd')}
    <circle cx="820" cy="300" r="150" fill="#ffe9b8" opacity="0.16"/>
    <circle cx="820" cy="300" r="106" fill="#fff0c4" opacity="0.30"/>
    <circle cx="820" cy="300" r="76" fill="#fff6dd"/>
    ${clouds('#ffffff', 0.5)}
    <ellipse cx="180" cy="${HORIZON - 40}" rx="230" ry="150" fill="#4b6b4a"/>
    <ellipse cx="900" cy="${HORIZON - 30}" rx="200" ry="130" fill="#44633f"/>
    <ellipse cx="540" cy="${HORIZON - 16}" rx="150" ry="86" fill="#527354"/>
    ${floor('#5b7a52', '#4a6644')}`,

  'bo-song': () => `
    ${sky('#4f7392', '#b9cbd6')}
    ${clouds('#ffffff', 0.38)}
    <rect x="0" y="${HORIZON - 210}" width="${FRAME.w}" height="210" fill="#3f5f77"/>
    <rect x="0" y="${HORIZON - 210}" width="${FRAME.w}" height="26" fill="#7ea3ba" opacity="0.6"/>
    <!-- Two still highlights, so the water reads as water without moving. -->
    <ellipse cx="300" cy="${HORIZON - 120}" rx="180" ry="14" fill="#a9c8d8" opacity="0.35"/>
    <ellipse cx="760" cy="${HORIZON - 70}" rx="150" ry="12" fill="#a9c8d8" opacity="0.28"/>
    <ellipse cx="120" cy="${HORIZON - 250}" rx="200" ry="70" fill="#3c5a4a"/>
    <ellipse cx="960" cy="${HORIZON - 240}" rx="180" ry="60" fill="#37543f"/>
    ${floor('#8d7f63', '#756a54')}`,

  'duoi-cay': () => `
    ${sky('#6b8fae', '#c2d2d8')}
    ${clouds('#ffffff', 0.34)}
    <rect x="740" y="${HORIZON - 620}" width="96" height="620" rx="18" fill="#5b4636"/>
    <rect x="740" y="${HORIZON - 620}" width="34" height="620" fill="#6d5643" opacity="0.8"/>
    <ellipse cx="790" cy="${HORIZON - 700}" rx="330" ry="230" fill="#3f5f3c"/>
    <ellipse cx="640" cy="${HORIZON - 640}" rx="220" ry="160" fill="#476b41"/>
    <ellipse cx="900" cy="${HORIZON - 620}" rx="190" ry="140" fill="#39563a"/>
    <ellipse cx="160" cy="${HORIZON - 60}" rx="220" ry="120" fill="#4d6c48"/>
    ${floor('#5b7a52', '#4a6644')}`,

  'duong-pho': () => `
    ${sky('#54607f', '#9aa3b8')}
    <rect x="60" y="${HORIZON - 560}" width="220" height="560" fill="#3f4661"/>
    <rect x="320" y="${HORIZON - 700}" width="180" height="700" fill="#464e6b"/>
    <rect x="820" y="${HORIZON - 620}" width="200" height="620" fill="#3b4258"/>
    <g fill="#ead79a" opacity="0.5">
      <rect x="100" y="${HORIZON - 500}" width="40" height="56"/>
      <rect x="190" y="${HORIZON - 400}" width="40" height="56"/>
      <rect x="360" y="${HORIZON - 620}" width="40" height="56"/>
      <rect x="430" y="${HORIZON - 470}" width="40" height="56"/>
      <rect x="870" y="${HORIZON - 540}" width="40" height="56"/>
      <rect x="940" y="${HORIZON - 380}" width="40" height="56"/>
    </g>
    ${floor('#4a4a52', '#3c3c45')}`,

  'ban-dem': () => `
    ${sky('#191d33', '#2f3550')}
    <circle cx="840" cy="270" r="70" fill="#f2ecd0"/>
    <circle cx="808" cy="248" r="60" fill="#212645"/>
    <g fill="#ffffff" opacity="0.75">
      <circle cx="160" cy="200" r="4"/><circle cx="300" cy="360" r="3"/>
      <circle cx="520" cy="180" r="3.5"/><circle cx="660" cy="420" r="3"/>
      <circle cx="220" cy="520" r="3"/><circle cx="960" cy="520" r="3.5"/>
      <circle cx="420" cy="620" r="2.5"/><circle cx="740" cy="660" r="2.5"/>
    </g>
    <ellipse cx="200" cy="${HORIZON - 40}" rx="260" ry="130" fill="#232840"/>
    <ellipse cx="920" cy="${HORIZON - 30}" rx="220" ry="110" fill="#1f2439"/>
    ${floor('#2a2f45', '#22273a')}`,
};

/** One backdrop, as an SVG string sized to the video frame. */
export function scenerySvg(id: SceneryId): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FRAME.w} ${FRAME.h}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">${SCENERY[id]()}</svg>`;
}
