/**
 * Zone map + original chroma → sRGB pixels (SPEC.md §6.6).
 *
 * Each pixel takes its zone's representative `L` and keeps the source `a`/`b`. The result is three
 * flat value steps that retain the hue and chroma of the photo, which is what makes it usable as a
 * colour reference rather than a greyscale study.
 *
 * The work is split the way SPEC.md §4 splits the pipeline. A pixel's rendered colour depends only
 * on its zone and its own `a`/`b`, and neither changes while a slider is being dragged — only
 * *which* zone the pixel is in changes. So the LAB→sRGB conversion happens once per image, and the
 * per-frame pass is a byte gather. Measured: 16.5ms → 3ms per frame at 1024×768 (NOTES.md).
 *
 * Pure: typed arrays in, typed arrays out.
 */

import { labToSrgbPixel } from './color';
import type { ZoneMap } from './threshold';
import type { Rgba } from './types';

/** One full-size RGBA buffer per zone: what the image looks like painted entirely in that zone. */
export type ZoneColours = readonly Rgba[];

/**
 * Precompute every pixel's colour in every zone. Expensive pass, once per image.
 *
 * Input: `a`/`b`, the source chroma channels; `zoneL`, the representative lightness (0–100) per
 * zone. Output: one RGBA buffer per zone, each `a.length * 4` bytes.
 */
export function buildZoneColours(
  a: Float32Array,
  b: Float32Array,
  zoneL: readonly number[],
): ZoneColours {
  return zoneL.map((L) => {
    const buffer = new Uint8ClampedArray(a.length * 4);
    for (let i = 0, p = 0; i < a.length; i++, p += 4) {
      labToSrgbPixel(L, a[i]!, b[i]!, buffer, p);
    }
    return buffer;
  });
}

/**
 * Paint the zone map, keeping the photo's hue and chroma.
 *
 * Input: `labels`, one byte per pixel; `zoneColours` from `buildZoneColours`, over the same pixel
 * count. Output: `out`, interleaved RGBA, written in place.
 *
 * Simplification runs on the label map before this, never on the output — filtering rendered RGB
 * produces grey fringes at zone boundaries (SPEC.md §6.5).
 */
export function renderZones(labels: ZoneMap, zoneColours: ZoneColours, out: Rgba): Rgba {
  for (let i = 0, p = 0; i < labels.length; i++, p += 4) {
    const source = zoneColours[labels[i]!]!;
    out[p] = source[p]!;
    out[p + 1] = source[p + 1]!;
    out[p + 2] = source[p + 2]!;
    out[p + 3] = 255;
  }
  return out;
}

/**
 * Paint the zone map as flat neutral greys, for painters who want to check values without hue
 * distraction. A toggle, never the default (SPEC.md §6.6).
 *
 * Input: `labels`, one byte per pixel; `zoneL`, the representative lightness per zone.
 * Output: `out`, interleaved RGBA, written in place.
 */
export function renderFlat(labels: ZoneMap, zoneL: readonly number[], out: Rgba): Rgba {
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
