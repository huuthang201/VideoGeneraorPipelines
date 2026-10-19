/**
 * The cast, as colour rather than as drawings.
 *
 * Four characters share one body — the same paths, the same proportions, the
 * same expression rig — and differ only by what is in this file plus a species
 * flag. That is deliberate and it is the whole reason a fifth character is
 * cheap: nobody draws anything again, they pick six colours.
 *
 * Two of these choices are load-bearing rather than cosmetic:
 *
 * **`rim` exists for the black dog.** A near-black animal on a dark backdrop
 * disappears - the silhouette is the only thing carrying it, and a silhouette
 * against dark is nothing. A cool rim light down the lit edge puts the shape
 * back. Every character gets one so the four look like they were lit on the
 * same stage; on the pale ones it is barely visible, which is correct.
 *
 * **`shadow` is never the base colour darkened.** Darkening a hue keeps its
 * temperature and the result reads as dirty. Shadows here move towards violet
 * and blue, which is what a shaded surface actually does under daylight, and is
 * what makes flat vector look like it has volume.
 */

export type Species = 'meo' | 'cho';
export type CharacterId = 'meo-trang' | 'meo-van' | 'cho-den' | 'cho-dom';

export interface Palette {
  id: CharacterId;
  /** Shown in logs and in the storyboard prompt's list of who exists. */
  label: string;
  species: Species;
  /** Lit side of every mass. */
  base: string;
  /** Shaded side. Cooler and more violet than `base`, never just darker. */
  shadow: string;
  /** The lightest plane, where the key light lands square on. */
  highlight: string;
  /** Cool light down the far edge, so the silhouette survives a dark backdrop. */
  rim: string;
  /** Markings: stripes on the tabby, patches on the spotted dog. */
  pattern: string;
  /** Inner ear, nose, paw pads, tongue. */
  pink: string;
  iris: string;
  /** Muzzle, chest and paw tips, where the fur goes pale on a real animal. */
  cream: string;
}

export const CAST: Record<CharacterId, Palette> = {
  /** Cream rather than white: a true white has no room left for a highlight. */
  'meo-trang': {
    id: 'meo-trang',
    label: 'Mèo trắng (cái)',
    species: 'meo',
    base: '#f4ece2',
    shadow: '#c7bcc9',
    highlight: '#fffaf3',
    rim: '#bcd8e8',
    pattern: '#e3d5c6',
    pink: '#f0a8b0',
    iris: '#4fb3a4',
    cream: '#fffdf9',
  },
  'meo-van': {
    id: 'meo-van',
    label: 'Mèo vằn (đực)',
    species: 'meo',
    base: '#e0913f',
    shadow: '#8c5330',
    highlight: '#f6bd6c',
    rim: '#ffd9a0',
    pattern: '#a9622c',
    pink: '#e58f92',
    iris: '#8fc04a',
    cream: '#f8e6cd',
  },
  /** The hardest of the four: everything here is about not going to pure black. */
  'cho-den': {
    id: 'cho-den',
    label: 'Chó đen (cái)',
    species: 'cho',
    base: '#3a3a46',
    shadow: '#20202b',
    highlight: '#585868',
    rim: '#8fb6d6',
    pattern: '#2a2a35',
    pink: '#c98a90',
    iris: '#e0a94a',
    cream: '#d8d2cc',
  },
  'cho-dom': {
    id: 'cho-dom',
    label: 'Chó đốm (đực)',
    species: 'cho',
    base: '#f2e6d4',
    shadow: '#c3b0a6',
    highlight: '#fff8ec',
    rim: '#c3dced',
    pattern: '#6b4a35',
    pink: '#e79a9a',
    iris: '#7a4a2a',
    cream: '#fffaf2',
  },
};
