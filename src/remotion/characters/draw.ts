import { CAST, type CharacterId, type Palette, type Species } from './palette';

/**
 * The cast, drawn.
 *
 * One chassis, four palettes, two species flags. Everything below is plain SVG
 * built as a string, which buys two things worth having: Remotion renders it
 * because a browser renders SVG, and `sharp` rasterises the identical markup on
 * the command line - so a contact sheet of every expression is one script away
 * and cannot drift from what the video shows.
 *
 * ## Why the vocabulary is closed
 *
 * Six expressions, three mouths, and nothing else. The engine already learned
 * this lesson with camera moves: *"a value in the whitelist is a value the
 * model will eventually reach for."* Leave poses open-ended and the model asks
 * for a character lying on its back holding a phone, and somebody has to draw
 * that. Closed vocabulary means the storyboard schema can enum it, the drawing
 * is finite, and no script can request art that does not exist.
 *
 * ## Why volume is faked in layers rather than filters
 *
 * No `feGaussianBlur` anywhere. librsvg (what `sharp` uses) and Chrome (what
 * Remotion uses) do not agree about filters, and a character that looks right
 * in the preview and wrong in the render is worse than one that looks the same
 * everywhere. Soft edges here are stacked translucent shapes, which both
 * renderers draw identically.
 */

export type Expression =
  | 'binh-thuong'
  | 'vui'
  | 'ngac-nhien'
  | 'nghi-ngo'
  | 'buon'
  | 'buon-ngu';

/** Overrides the expression's own mouth while a character is speaking. */
export type Mouth = 'dong' | 'hoi-mo' | 'mo';

/**
 * Three stances, and the head is the same drawing in all of them.
 *
 * The face carries the performance, so it is drawn once and moved: a pose
 * changes the body, the legs, the tail and the contact shadow, then translates
 * the head to sit on top. That is why adding a pose costs one entry here
 * rather than a redraw of four characters - and why the expressions cannot
 * drift between poses, because there is only one of each.
 *
 * `dung` is upright on the hind legs rather than on all fours. On all fours the
 * head turns side-on and every expression has to be redrawn in profile; upright
 * keeps the face square to camera and buys gestures a quadruped cannot make,
 * which is most of what an explainer needs.
 */
export type Pose = 'ngoi' | 'dung' | 'nam';

export const POSES: Pose[] = ['ngoi', 'dung', 'nam'];

export const EXPRESSIONS: Expression[] = [
  'binh-thuong',
  'vui',
  'ngac-nhien',
  'nghi-ngo',
  'buon',
  'buon-ngu',
];

export const VIEWBOX = { w: 1000, h: 1200 };

/** Per-pose geometry. Everything a stance changes lives here and nowhere else. */
const STANCE: Record<Pose, { headDy: number; headScale: number; groundRx: number; groundY: number }> = {
  ngoi: { headDy: 0, headScale: 1, groundRx: 290, groundY: 1092 },
  dung: { headDy: -84, headScale: 0.94, groundRx: 206, groundY: 1104 },
  nam: { headDy: 92, headScale: 1, groundRx: 340, groundY: 1076 },
};

/** Where every part sits. Named so the numbers are arguable, not magic. */
const G = {
  headX: 500,
  headY: 430,
  headRx: 232,
  headRy: 212,
  eyeY: 440,
  eyeDx: 118,
  eyeR: 62,
  bodyTop: 640,
  bodyBottom: 1078,
  groundY: 1092,
};

function defs(p: Palette, ns: string): string {
  return `
  <defs>
    <radialGradient id="${ns}-form" cx="34%" cy="26%" r="82%">
      <stop offset="0%" stop-color="${p.highlight}"/>
      <stop offset="52%" stop-color="${p.base}"/>
      <stop offset="100%" stop-color="${p.shadow}"/>
    </radialGradient>
    <radialGradient id="${ns}-body" cx="38%" cy="18%" r="88%">
      <stop offset="0%" stop-color="${p.base}"/>
      <stop offset="62%" stop-color="${p.base}"/>
      <stop offset="100%" stop-color="${p.shadow}"/>
    </radialGradient>
    <linearGradient id="${ns}-iris" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${p.shadow}"/>
      <stop offset="38%" stop-color="${p.iris}"/>
      <stop offset="100%" stop-color="${p.highlight}"/>
    </linearGradient>
  </defs>`;
}

/**
 * Contact shadow.
 *
 * Three stacked ellipses rather than one blurred one - see the note above about
 * filters. Without this the character floats, and floating is the single
 * clearest tell of cheap vector animation.
 */
function ground(pose: Pose): string {
  const { groundRx: r, groundY: y } = STANCE[pose];
  return `
  <g opacity="0.5">
    <ellipse cx="500" cy="${y}" rx="${r}" ry="${r * 0.18}" fill="#1b1420" opacity="0.16"/>
    <ellipse cx="500" cy="${y}" rx="${r * 0.79}" ry="${r * 0.14}" fill="#1b1420" opacity="0.20"/>
    <ellipse cx="500" cy="${y}" rx="${r * 0.55}" ry="${r * 0.10}" fill="#1b1420" opacity="0.24"/>
  </g>`;
}

function tail(p: Palette, ns: string, pose: Pose): string {
  const RINGS: Record<Pose, [number, number][]> = {
    ngoi: [[812, 862], [852, 790], [874, 712], [858, 652]],
    dung: [[782, 812], [826, 744], [846, 672], [826, 616]],
    nam: [[770, 1006], [830, 986], [872, 942], [874, 892]],
  };
  const stripes =
    p.id === 'meo-van'
      ? RINGS[pose]
          .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${32 - i * 5}" fill="${p.pattern}" opacity="0.75"/>`)
          .join('')
      : '';

  // The cat's tail is thin and lifts; the dog's is shorter and thicker. Where
  // it leaves the body depends on the stance, so each pose names its own curve.
  const PATHS: Record<Pose, { meo: string; cho: string }> = {
    ngoi: {
      meo: 'M660 960 C 790 980, 900 880, 886 720 C 880 640, 830 610, 800 640 C 776 664, 800 700, 828 690',
      cho: 'M648 946 C 774 966, 876 892, 874 782 C 872 706, 806 678, 770 726',
    },
    dung: {
      meo: 'M628 906 C 754 926, 862 830, 856 690 C 852 612, 796 586, 766 620 C 742 646, 768 684, 796 674',
      cho: 'M622 900 C 742 922, 840 848, 840 748 C 840 676, 780 650, 746 694',
    },
    nam: {
      meo: 'M726 1024 C 848 1030, 906 962, 884 890 C 866 832, 800 826, 782 872 C 768 908, 806 932, 830 914',
      cho: 'M716 1020 C 830 1026, 884 964, 866 902 C 852 852, 796 844, 776 884',
    },
  };
  const path = PATHS[pose][p.species];

  return `
  <g>
    <path d="${path}" fill="none" stroke="${p.shadow}" stroke-width="${p.species === 'meo' ? 62 : 78}" stroke-linecap="round"/>
    <path d="${path}" fill="none" stroke="url(#${ns}-form)" stroke-width="${p.species === 'meo' ? 50 : 64}" stroke-linecap="round"/>
    <g clip-path="none">${stripes}</g>
  </g>`;
}

/** Half-width, top and bottom of the torso in each stance. */
const TORSO: Record<Pose, { top: number; bottom: number; halfTop: number; halfMid: number }> = {
  ngoi: { top: 640, bottom: 1078, halfTop: 148, halfMid: 208 },
  // Standing is narrower and stops short of the floor - the legs finish it.
  dung: { top: 590, bottom: 946, halfTop: 132, halfMid: 168 },
  // Lying is the loaf: low, wide, and almost as broad at the top as the bottom.
  nam: { top: 700, bottom: 1054, halfTop: 250, halfMid: 288 },
};

function body(p: Palette, ns: string, pose: Pose): string {
  const t = TORSO[pose];
  const d = `M ${500 - t.halfTop} ${t.top}
    C ${500 - t.halfMid} ${t.top + 110}, ${500 - t.halfMid + 4} ${t.bottom - 110}, ${500 - t.halfTop - 2} ${t.bottom - 18}
    C ${500 - 96} ${t.bottom + 34}, ${500 + 96} ${t.bottom + 34}, ${500 + t.halfTop + 2} ${t.bottom - 18}
    C ${500 + t.halfMid - 4} ${t.bottom - 110}, ${500 + t.halfMid} ${t.top + 110}, ${500 + t.halfTop} ${t.top} Z`;

  const mid = (t.top + t.bottom) / 2;
  const patches =
    p.id === 'cho-dom'
      ? `<ellipse cx="${500 + t.halfTop - 36}" cy="${mid + 40}" rx="78" ry="92" fill="${p.pattern}" opacity="0.9"/>`
      : '';

  const stripes =
    p.id === 'meo-van'
      ? [0, 1, 2]
          .map(
            (i) =>
              `<path d="M ${500 - t.halfMid + 30 + i * 6} ${t.top + (pose === 'nam' ? 140 : 90) + i * 78} q ${t.halfMid - 30} -44 ${(t.halfMid - 30) * 2} 0" fill="none" stroke="${p.pattern}" stroke-width="26" stroke-linecap="round" opacity="0.65"/>`,
          )
          .join('')
      : '';

  return `
  <g>
    <path d="${d}" fill="url(#${ns}-body)"/>
    <clipPath id="${ns}-bodyclip"><path d="${d}"/></clipPath>
    <g clip-path="url(#${ns}-bodyclip)">
      ${patches}
      ${stripes}
      <!-- Pale chest, where fur goes light on a real animal. -->
      <ellipse cx="500" cy="${t.bottom - 110}" rx="${pose === 'nam' ? 150 : 112}" ry="${pose === 'nam' ? 118 : 170}" fill="${p.cream}" opacity="0.55"/>
      <!-- The head's own shadow, cast down onto the chest. -->
      <ellipse cx="500" cy="${t.top - 10}" rx="${t.halfMid}" ry="86" fill="${p.shadow}" opacity="0.5"/>
      <!-- Rim light down the far edge. -->
      <path d="M ${500 + t.halfTop} ${t.top} C ${500 + t.halfMid - 2} ${t.top + 120}, ${500 + t.halfMid - 6} ${t.bottom - 110}, ${500 + t.halfTop - 2} ${t.bottom - 20}"
            fill="none" stroke="${p.rim}" stroke-width="16" stroke-linecap="round" opacity="0.5"/>
    </g>
  </g>`;
}

function paws(p: Palette, ns: string, pose: Pose): string {
  const t = TORSO[pose];

  /** One rounded paw, lit the same way as everything else. */
  const paw = (cx: number, cy: number, rx = 58, ry = 42) => `
    <ellipse cx="${cx}" cy="${cy + 8}" rx="${rx + 4}" ry="${ry + 4}" fill="${p.shadow}"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#${ns}-form)"/>
    <ellipse cx="${cx - 6}" cy="${cy - 10}" rx="${rx * 0.58}" ry="${ry * 0.48}" fill="${p.cream}" opacity="0.5"/>`;

  if (pose === 'dung') {
    // Two hind legs carry the weight; the front paws hang free at the sides,
    // which is the whole reason this pose exists - a character standing can
    // point at the thing it is talking about.
    /** A short upper arm, so the front paw is attached to something. */
    const arm = (flip: number) => `
      <path d="M ${500 + flip * (t.halfTop - 14)} ${t.top + 78}
               q ${flip * 60} 30 ${flip * 58} 118 l ${flip * -50} 6
               q ${flip * -4} -70 ${flip * -46} -96 Z" fill="${p.shadow}"/>
      <path d="M ${500 + flip * (t.halfTop - 20)} ${t.top + 84}
               q ${flip * 50} 28 ${flip * 48} 104 l ${flip * -40} 4
               q ${flip * -4} -62 ${flip * -38} -84 Z" fill="url(#${ns}-form)"/>`;

    const leg = (cx: number) => `
      <path d="M ${cx - 44} ${t.bottom - 40} q 44 -16 88 0 l 6 118 q -50 22 -100 0 Z" fill="${p.shadow}"/>
      <path d="M ${cx - 38} ${t.bottom - 34} q 38 -14 76 0 l 4 108 q -42 18 -84 0 Z" fill="url(#${ns}-form)"/>`;
    return `<g>
      ${leg(430)}${leg(570)}
      ${paw(430, 1074, 62, 40)}${paw(570, 1074, 62, 40)}
      ${arm(-1)}${arm(1)}
      ${paw(500 - t.halfMid - 14, t.top + 214, 46, 54)}
      ${paw(500 + t.halfMid + 14, t.top + 214, 46, 54)}
    </g>`;
  }

  if (pose === 'nam') {
    // Sphinx: the forelegs run forward along the floor, which is what says
    // "lying down" rather than "sitting very low".
    const foreleg = (cx: number) => `
      <path d="M ${cx - 46} ${t.bottom - 116} q 46 -22 92 0 l 14 128 q -60 22 -120 0 Z"
            fill="${p.shadow}"/>
      <path d="M ${cx - 38} ${t.bottom - 106} q 38 -18 76 0 l 11 112 q -49 18 -98 0 Z"
            fill="url(#${ns}-form)"/>
      <!-- Where the leg leaves the body. Without it the two masses are one. -->
      <path d="M ${cx - 46} ${t.bottom - 112} q 46 -20 92 0" fill="none"
            stroke="${p.shadow}" stroke-width="14" stroke-linecap="round" opacity="0.85"/>`;

    /** Toes, so the end of the leg is a paw and not a rounded stump. */
    const toes = (cx: number) => `
      <g opacity="0.5" stroke="${p.shadow}" stroke-width="7" stroke-linecap="round">
        <path d="M ${cx - 20} 1036 v 22"/><path d="M ${cx} 1032 v 26"/><path d="M ${cx + 20} 1036 v 22"/>
      </g>`;

    return `<g>
      ${foreleg(384)}${foreleg(616)}
      ${paw(384, 1048, 66, 36)}${toes(384)}
      ${paw(616, 1048, 66, 36)}${toes(616)}
    </g>`;
  }

  return `<g>${paw(418, t.bottom - 14)}${paw(582, t.bottom - 14)}</g>`;
}

function ears(p: Palette, ns: string, pose: Pose): string {
  const { headDy, headScale } = STANCE[pose];
  const wrap = (inner: string) =>
    `<g transform="translate(${(1 - headScale) * G.headX} ${headDy + (1 - headScale) * G.headY}) scale(${headScale})">${inner}</g>`;
  if (p.species === 'meo') {
    const one = (x: number, flip: number) => `
      <path d="M ${x} 300 L ${x + flip * 40} 168 L ${x + flip * 150} 292 Z"
            fill="${p.shadow}"/>
      <path d="M ${x + flip * 8} 296 L ${x + flip * 44} 190 L ${x + flip * 132} 288 Z"
            fill="url(#${ns}-form)"/>
      <path d="M ${x + flip * 26} 288 L ${x + flip * 48} 218 L ${x + flip * 106} 282 Z"
            fill="${p.pink}" opacity="0.85"/>`;
    return wrap(`${one(318, 1)}${one(682, -1)}`);
  }

  // Folded flaps: a dog ear reads as a hanging mass, not a triangle.
  const one = (x: number, flip: number) => `
    <path d="M ${x} 296 C ${x - flip * 110} 292, ${x - flip * 168} 412, ${x - flip * 140} 540
             C ${x - flip * 122} 610, ${x - flip * 30} 590, ${x + flip * 10} 520 Z"
          fill="${p.shadow}"/>
    <path d="M ${x - flip * 10} 308 C ${x - flip * 100} 308, ${x - flip * 150} 416, ${x - flip * 126} 528
             C ${x - flip * 110} 584, ${x - flip * 40} 570, ${x - flip * 4} 512 Z"
          fill="url(#${ns}-form)"/>
    <!-- Outer contour, lit. On a near-black dog this is the only thing telling
         the ear from the head; on a pale one it is barely there, as it should be. -->
    <path d="M ${x - flip * 10} 312 C ${x - flip * 100} 312, ${x - flip * 148} 418, ${x - flip * 124} 526"
          fill="none" stroke="${p.rim}" stroke-width="11" stroke-linecap="round" opacity="0.55"/>
    <!-- The fold where it hangs off the skull. -->
    <path d="M ${x - flip * 6} 320 q ${flip * 18} 54 ${flip * 4} 104"
          fill="none" stroke="${p.shadow}" stroke-width="13" stroke-linecap="round" opacity="0.75"/>`;
  return wrap(`${one(352, 1)}${one(648, -1)}`);
}

function eye(p: Palette, ns: string, cx: number, expr: Expression, side: 'trai' | 'phai'): string {
  const cy = G.eyeY;
  const r = expr === 'ngac-nhien' ? G.eyeR + 12 : G.eyeR;

  // Closed eyes are a stroked arc, not a filled shape - the same curve reads as
  // asleep pointing down and as delighted pointing up, which is most of what an
  // expression is.
  if (expr === 'buon-ngu') {
    return `<path d="M ${cx - 54} ${cy + 10} q 54 -52 108 0"
                  fill="none" stroke="#2a2230" stroke-width="17" stroke-linecap="round"/>`;
  }

  const lid =
    expr === 'nghi-ngo' && side === 'trai'
      ? `<rect x="${cx - r - 4}" y="${cy - r - 6}" width="${r * 2 + 8}" height="${r + 6}" fill="${p.base}"/>
         <path d="M ${cx - r} ${cy - 2} q ${r} -22 ${r * 2} 0" fill="none" stroke="#2a2230" stroke-width="14" stroke-linecap="round"/>`
      : expr === 'buon'
        ? `<path d="M ${cx - r - 2} ${cy - r + 16} q ${r} ${side === 'trai' ? -26 : -26} ${r * 2} ${side === 'trai' ? 30 : -30}"
                 fill="none" stroke="#2a2230" stroke-width="14" stroke-linecap="round" opacity="0.9"/>`
        : '';

  return `
  <g>
    <ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r + 4}" fill="#ffffff"/>
    <ellipse cx="${cx}" cy="${cy - 6}" rx="${r}" ry="${r - 6}" fill="url(#${ns}-iris)" opacity="0.96"/>
    <ellipse cx="${cx}" cy="${cy + 2}" rx="${r * 0.46}" ry="${r * 0.66}" fill="#241d2c"/>
    <circle cx="${cx - r * 0.34}" cy="${cy - r * 0.4}" r="${r * 0.26}" fill="#ffffff" opacity="0.95"/>
    <circle cx="${cx + r * 0.28}" cy="${cy + r * 0.3}" r="${r * 0.12}" fill="#ffffff" opacity="0.55"/>
    ${lid}
  </g>`;
}

function brows(expr: Expression): string {
  const y = G.eyeY - 82;
  const L = 500 - G.eyeDx;
  const R = 500 + G.eyeDx;
  const line = (cx: number, dy: number, rot: number) =>
    `<path d="M ${cx - 46} ${y + dy} q 46 -16 92 0" fill="none" stroke="#2a2230" stroke-width="15"
           stroke-linecap="round" transform="rotate(${rot} ${cx} ${y + dy})" opacity="0.85"/>`;

  if (expr === 'ngac-nhien') return line(L, -18, 0) + line(R, -18, 0);
  if (expr === 'nghi-ngo') return line(L, 6, 0) + line(R, -22, -14);
  if (expr === 'buon') return line(L, 4, 16) + line(R, 4, -16);
  return '';
}

function muzzle(p: Palette, ns: string, expr: Expression, mouth: Mouth | null): string {
  const my = p.species === 'meo' ? 548 : 566;
  const snout =
    p.species === 'meo'
      ? `<ellipse cx="500" cy="${my + 16}" rx="104" ry="72" fill="${p.cream}" opacity="0.8"/>`
      : `<ellipse cx="500" cy="${my + 26}" rx="132" ry="96" fill="${p.shadow}" opacity="0.35"/>
         <ellipse cx="500" cy="${my + 20}" rx="126" ry="90" fill="${p.cream}" opacity="0.92"/>`;

  const noseW = p.species === 'meo' ? 34 : 46;
  const nose = `
    <path d="M ${500 - noseW} ${my - 12} q ${noseW} -18 ${noseW * 2} 0 q ${-noseW} ${noseW * 1.1} ${-noseW * 2} 0 Z"
          fill="${p.pink}"/>
    <ellipse cx="${500 - noseW * 0.3}" cy="${my - 14}" rx="${noseW * 0.34}" ry="${noseW * 0.2}" fill="#ffffff" opacity="0.45"/>`;

  const lips =
    mouth === 'mo'
      ? `<path d="M 440 ${my + 34} q 60 76 120 0 q -60 26 -120 0 Z" fill="#5b2c39"/>
         <path d="M 468 ${my + 62} q 32 30 64 0 q -32 12 -64 0 Z" fill="${p.pink}" opacity="0.9"/>`
      : mouth === 'hoi-mo'
        ? `<path d="M 452 ${my + 32} q 48 40 96 0 q -48 14 -96 0 Z" fill="#5b2c39"/>`
        : expr === 'vui'
          ? `<path d="M 448 ${my + 26} q 52 46 104 0" fill="none" stroke="#3a2a33" stroke-width="14" stroke-linecap="round"/>`
          : expr === 'buon'
            ? `<path d="M 456 ${my + 52} q 44 -34 88 0" fill="none" stroke="#3a2a33" stroke-width="14" stroke-linecap="round"/>`
            : expr === 'ngac-nhien'
              ? `<ellipse cx="500" cy="${my + 44}" rx="26" ry="32" fill="#5b2c39"/>`
              : expr === 'nghi-ngo'
                ? `<path d="M 458 ${my + 38} l 84 -8" fill="none" stroke="#3a2a33" stroke-width="14" stroke-linecap="round"/>`
                : `<path d="M 500 ${my + 14} v 20 M 466 ${my + 42} q 34 24 68 0" fill="none" stroke="#3a2a33" stroke-width="13" stroke-linecap="round"/>`;

  const whiskers =
    p.species === 'meo'
      ? [0, 1, 2]
          .map((i) => {
            const wy = my + 4 + i * 26;
            return `<path d="M 392 ${wy} q -90 ${-10 + i * 10} -150 ${-2 + i * 16}" fill="none" stroke="#6a5a63" stroke-width="7" stroke-linecap="round" opacity="0.7"/>
                    <path d="M 608 ${wy} q 90 ${-10 + i * 10} 150 ${-2 + i * 16}" fill="none" stroke="#6a5a63" stroke-width="7" stroke-linecap="round" opacity="0.7"/>`;
          })
          .join('')
      : '';

  return `<g>${snout}${nose}${lips}${whiskers}</g>`;
}

function head(p: Palette, ns: string, expr: Expression, mouth: Mouth | null, pose: Pose): string {
  const { headDy, headScale } = STANCE[pose];
  const patch =
    p.id === 'cho-dom'
      ? `<ellipse cx="${500 + G.eyeDx + 20}" cy="${G.eyeY - 24}" rx="122" ry="110" fill="${p.pattern}" opacity="0.92"/>`
      : '';

  const stripes =
    p.id === 'meo-van'
      ? `<path d="M 500 236 v 96 M 430 250 l -18 92 M 570 250 l 18 92" fill="none" stroke="${p.pattern}" stroke-width="24" stroke-linecap="round" opacity="0.7"/>`
      : '';

  return `
  <g transform="translate(${(1 - headScale) * G.headX} ${headDy + (1 - headScale) * G.headY}) scale(${headScale})">
    <ellipse cx="${G.headX}" cy="${G.headY}" rx="${G.headRx}" ry="${G.headRy}" fill="url(#${ns}-form)"/>
    <clipPath id="${ns}-headclip">
      <ellipse cx="${G.headX}" cy="${G.headY}" rx="${G.headRx}" ry="${G.headRy}"/>
    </clipPath>
    <g clip-path="url(#${ns}-headclip)">
      ${patch}
      ${stripes}
      <ellipse cx="${G.headX + 200}" cy="${G.headY}" rx="60" ry="${G.headRy}" fill="${p.rim}" opacity="0.4"/>
      <ellipse cx="${G.headX - 96}" cy="${G.headY - 108}" rx="120" ry="84" fill="${p.highlight}" opacity="0.35"/>
    </g>
    ${brows(expr)}
    ${eye(p, ns, 500 - G.eyeDx, expr, 'trai')}
    ${eye(p, ns, 500 + G.eyeDx, expr, 'phai')}
    ${muzzle(p, ns, expr, mouth)}
  </g>`;
}

export interface CharacterOptions {
  id: CharacterId;
  expression?: Expression;
  /** Set only while the character is speaking; otherwise the expression decides. */
  mouth?: Mouth | null;
  pose?: Pose;
  /** Namespaces gradient ids so several characters can share one frame. */
  instance?: string;
  /**
   * Scale to the container instead of to the drawing.
   *
   * The intrinsic 1000x1200 is what `sharp` needs to rasterise a contact sheet,
   * and it is exactly wrong inside a laid-out frame: an svg carrying its own
   * width ignores the box it was put in, so a character placed in a 512px slot
   * still drew at 1000px and walked off the side of the video. The browser gets
   * percentages and obeys the layout; the command line keeps the numbers.
   */
  fill?: boolean;
}

/** One character, as an SVG string sized to `VIEWBOX`. */
export function characterSvg(opts: CharacterOptions): string {
  const p = CAST[opts.id];
  const expr = opts.expression ?? 'binh-thuong';
  const pose = opts.pose ?? 'ngoi';
  const ns = `${opts.id}-${opts.instance ?? 'a'}`;

  const size = opts.fill
    ? 'width="100%" height="100%" preserveAspectRatio="xMidYMax meet"'
    : `width="${VIEWBOX.w}" height="${VIEWBOX.h}"`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWBOX.w} ${VIEWBOX.h}" ${size}>
    ${defs(p, ns)}
    ${ground(pose)}
    ${tail(p, ns, pose)}
    ${body(p, ns, pose)}
    ${paws(p, ns, pose)}
    ${ears(p, ns, pose)}
    ${head(p, ns, expr, opts.mouth ?? null, pose)}
  </svg>`;
}

export { CAST };
export type { CharacterId, Palette, Species };
