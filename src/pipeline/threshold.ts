/**
 * Corrected `L` → three zone labels (SPEC.md §6.4).
 *
 * Pure: typed arrays in, typed arrays out.
 */

export const ZONE_DARK = 0;
export const ZONE_MID = 1;
export const ZONE_LIGHT = 2;

/** One byte per pixel, holding `ZONE_DARK` / `ZONE_MID` / `ZONE_LIGHT`. */
export type ZoneMap = Uint8Array;

/** The two boundaries, as positions on the `L` scale (0–100). */
export interface Cuts {
  /** `L` below this is dark. */
  dark: number;
  /** `L` at or above this is light. */
  light: number;
}

/**
 * Keep the pair ordered after one of them moved.
 *
 * The light/mid boundary can never cross below the mid/dark boundary. Clamp rather than swap: the
 * boundary the painter is not touching must not jump under their finger. `moved` names the one
 * that was just dragged; the other one holds still and the dragged one is clamped to it.
 */
export function clampCuts(cuts: Cuts, moved: 'dark' | 'light'): Cuts {
  if (cuts.dark <= cuts.light) {
    return cuts;
  }
  return moved === 'dark'
    ? { dark: cuts.light, light: cuts.light }
    : { dark: cuts.dark, light: cuts.dark };
}

/**
 * Label each pixel by which of the three value zones its lightness falls in.
 *
 * Input: `L` 0–100; `cuts` as positions on the same scale, assumed already ordered by
 * `clampCuts`. Output: `out`, one byte per pixel.
 *
 * Boundaries are half-open: dark is `L < dark`, light is `L >= light`, mid is everything between.
 * A pixel exactly on a boundary therefore always lands in the lighter of the two zones.
 */
export function thresholdL(L: Float32Array, cuts: Cuts, out: ZoneMap): ZoneMap {
  const { dark, light } = cuts;
  for (let i = 0; i < L.length; i++) {
    const v = L[i]!;
    out[i] = v < dark ? ZONE_DARK : v < light ? ZONE_MID : ZONE_LIGHT;
  }
  return out;
}
