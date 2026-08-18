/**
 * Aerial perspective (SPEC.md §6.3): the painter's move of pushing distance back, automated.
 *
 * Two separate things live here, because they serve different purposes:
 *
 * - `hazeDistance` fakes atmospheric haze on the *reference photo*. It is a preview, to see where
 *   the depth map thinks distance is and what treating it as distance would look like.
 * - `liftDistance` is the correction proper, applied to `L` *before* thresholding, so distant
 *   planes stop taking the darkest values and the darkest darks belong to the subject.
 *
 * Both are driven by the same two numbers: where distance begins, and how strongly to treat it.
 * Below the start nothing happens at all, which is what lets the painter say "the background
 * begins here" rather than having the whole picture drift.
 *
 * Pure: typed arrays in, typed arrays out.
 */

import { AERIAL_L_CEILING, HAZE_COLOUR, HAZE_DESATURATION } from '../constants';
import type { Rgba } from './types';

export interface AerialSettings {
  /** Where the effect begins, on the 0–1 depth scale. Nearer than this is untouched. */
  start: number;
  /** How strongly to apply it, 0–1. */
  strength: number;
}

/**
 * How far past the start a given depth is, 0–1.
 *
 * Input: `depth` 0–1 where 1 is farthest; `start` 0–1. Output: 0 at and before the start, rising
 * linearly to 1 at the far limit.
 *
 * A start of 1 or more disables the effect rather than dividing by zero.
 */
export function distanceRamp(depth: number, start: number): number {
  const span = 1 - start;
  if (span <= 0) {
    return 0;
  }
  const t = (depth - start) / span;
  return t <= 0 ? 0 : t >= 1 ? 1 : t;
}

/**
 * Lighten distant pixels, the correction SPEC.md §6.3 specifies.
 *
 * Input: `L` 0–100; `depth` 0–1, 1 = farthest. Output: `out`, 0–100.
 *
 * `L' = L + strength · ramp · (ceiling − L)` — which lifts a far pixel towards the ceiling in
 * proportion to how dark it is and how far away, and leaves near pixels exactly alone. Dark
 * distant planes move a long way, pale ones barely at all, which is what stops a distant hillside
 * competing with the subject for the darkest value in the picture.
 */
export function liftDistance(
  L: Float32Array,
  depth: Float32Array,
  settings: AerialSettings,
  out: Float32Array,
): Float32Array {
  const { start, strength } = settings;
  if (strength <= 0) {
    out.set(L);
    return out;
  }

  for (let i = 0; i < L.length; i++) {
    const lightness = L[i]!;
    const t = strength * distanceRamp(depth[i]!, start);
    const lifted = lightness + t * (AERIAL_L_CEILING - lightness);
    out[i] = lifted < 0 ? 0 : lifted > 100 ? 100 : lifted;
  }
  return out;
}

/**
 * Fake atmospheric haze over distance, for previewing the depth map on the photo.
 *
 * Input: `rgba` interleaved sRGB; `depth` 0–1, 1 = farthest. Output: `out`, written in place.
 *
 * Distance is first drained of colour, then mixed towards a pale blue. Doing both is what makes
 * it read as air rather than as fog: draining alone looks like a faded photograph, and mixing
 * alone turns warm colours an unconvincing purple on the way.
 */
export function hazeDistance(
  rgba: Rgba,
  depth: Float32Array,
  settings: AerialSettings,
  out: Rgba,
): Rgba {
  const { start, strength } = settings;
  if (strength <= 0) {
    out.set(rgba);
    return out;
  }

  const [hazeR, hazeG, hazeB] = HAZE_COLOUR;

  for (let i = 0, p = 0; i < depth.length; i++, p += 4) {
    const t = strength * distanceRamp(depth[i]!, start);
    const r = rgba[p]!;
    const g = rgba[p + 1]!;
    const b = rgba[p + 2]!;

    if (t <= 0) {
      out[p] = r;
      out[p + 1] = g;
      out[p + 2] = b;
      out[p + 3] = 255;
      continue;
    }

    // Rec. 709 luma, computed on the encoded values. Good enough for a preview, and it keeps this
    // off the LAB round trip that the study itself needs.
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const drain = t * HAZE_DESATURATION;
    const dr = r + (luma - r) * drain;
    const dg = g + (luma - g) * drain;
    const db = b + (luma - b) * drain;

    out[p] = dr + (hazeR - dr) * t;
    out[p + 1] = dg + (hazeG - dg) * t;
    out[p + 2] = db + (hazeB - db) * t;
    out[p + 3] = 255;
  }
  return out;
}
