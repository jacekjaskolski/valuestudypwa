/**
 * Zone map + original chroma → sRGB pixels (SPEC.md §6.6).
 *
 * Each pixel takes its zone's representative `L` and keeps the source `a`/`b`. The result is three
 * flat value steps that retain the hue and chroma of the photo, which is what makes it usable as a
 * colour reference rather than a greyscale study.
 *
 * Pure: typed arrays in, typed arrays out.
 */

import { labToSrgbPixel } from './color';
import type { ZoneMap } from './threshold';
import type { Rgba } from './types';

export interface RenderOptions {
  /** Drop `a`/`b` and output neutral grey steps. A toggle, never the default. */
  greyscale: boolean;
}

/**
 * Paint the zone map.
 *
 * Input: `labels`, one byte per pixel; `a`/`b`, the source chroma channels; `zoneL`, the
 * representative lightness (0–100) for each zone, indexed by label.
 * Output: `out`, interleaved RGBA, written in place.
 *
 * Simplification runs on the label map before this, never on the output — filtering rendered RGB
 * produces grey fringes at zone boundaries (SPEC.md §6.5).
 */
export function renderZones(
  labels: ZoneMap,
  a: Float32Array,
  b: Float32Array,
  zoneL: readonly number[],
  options: RenderOptions,
  out: Rgba,
): Rgba {
  if (options.greyscale) {
    // Only `zoneL.length` distinct colours exist, so convert once and copy.
    const palette = new Uint8ClampedArray(zoneL.length * 4);
    for (let z = 0; z < zoneL.length; z++) {
      labToSrgbPixel(zoneL[z]!, 0, 0, palette, z * 4);
    }
    for (let i = 0, p = 0; i < labels.length; i++, p += 4) {
      const q = labels[i]! * 4;
      out[p] = palette[q]!;
      out[p + 1] = palette[q + 1]!;
      out[p + 2] = palette[q + 2]!;
      out[p + 3] = 255;
    }
    return out;
  }

  for (let i = 0, p = 0; i < labels.length; i++, p += 4) {
    labToSrgbPixel(zoneL[labels[i]!]!, a[i]!, b[i]!, out, p);
  }
  return out;
}
