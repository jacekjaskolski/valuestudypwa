/**
 * Shape simplification (SPEC.md §6.5). This is what separates a painting reference from a
 * posterize filter: the painter needs paintable shapes, not pixel noise.
 *
 * Runs on the label map, never on the rendered RGB — filtering the output would produce grey
 * fringes at zone boundaries.
 *
 * Two stages, driven by a single strength:
 *
 * 1. A **majority filter** over a square window. This is where the spec's morphological open and
 *    close plus boundary smoothing all land: taking the most common label in a neighbourhood
 *    removes speckle, fills pinholes and rounds off jagged edges in one pass. Done with a sliding
 *    window in each axis, so the cost does not grow with the window size — a k×k erode/dilate/
 *    erode/dilate per zone would have been four passes of k² work each.
 * 2. **Small-region removal**, for isolated shapes too large for the window to swallow. Each is
 *    absorbed into whichever zone borders it most.
 *
 * Three zones is a fixture of the tool, not a parameter: the whole point is a 3-value study.
 *
 * The two stages have very different costs — roughly 20ms and 26ms at 1024×768 (NOTES.md) — so
 * the caller is expected to run the majority filter every frame and the region removal only once
 * the controls settle, which is the fallback SPEC.md §4 calls for.
 *
 * Pure: typed arrays in, typed arrays out.
 */

import {
  FOCUS_WEIGHT_THRESHOLD,
  SIMPLIFY_MAX_AREA_FRACTION,
  SIMPLIFY_MAX_RADIUS_FRACTION,
} from '../constants';
import { labelUniformRegions } from './regions';
import { ZONE_DARK, ZONE_LIGHT, ZONE_MID, type ZoneMap } from './threshold';

export interface SimplifySettings {
  /** Half-width of the majority window, in pixels. Below 1 the filter is skipped. */
  radius: number;
  /** Regions smaller than this many pixels are absorbed. Below 2 the removal is skipped. */
  minArea: number;
}

/**
 * Turn the single Simplify slider into the two settings.
 *
 * Input: `strength` 0–1; image size in pixels. Output: settings in pixels, scaled to the image so
 * the same slider position means the same thing at any working resolution (SPEC.md §6.5 asks for
 * the area threshold as a fraction, not a pixel count).
 */
export function simplifySettings(
  strength: number,
  width: number,
  height: number,
): SimplifySettings {
  const clamped = strength < 0 ? 0 : strength > 1 ? 1 : strength;
  return {
    radius: Math.round(clamped * SIMPLIFY_MAX_RADIUS_FRACTION * Math.max(width, height)),
    minArea: clamped * SIMPLIFY_MAX_AREA_FRACTION * width * height,
  };
}

/**
 * Buffers the two stages need, allocated once per image so that dragging allocates nothing.
 *
 * The horizontal pass writes one plane per zone rather than one interleaved array: the vertical
 * pass then reads each plane in order instead of striding over three.
 */
export interface SimplifyScratch {
  /** Per-zone window counts from the horizontal pass, one full-size plane each. */
  planes: [Uint16Array, Uint16Array, Uint16Array];
  /** Per-column running totals for the vertical pass, one per zone. */
  columns: [Uint32Array, Uint32Array, Uint32Array];
  /** Three counters indexed by label, for the horizontal pass's sliding window. */
  window: Uint32Array;
  /** Region id per pixel, for small-region removal. */
  ids: Int32Array;
  /** Flood-fill stack. */
  stack: Int32Array;
  /** The stage-one result, handed to stage two. */
  intermediate: ZoneMap;
}

export function createSimplifyScratch(width: number, height: number): SimplifyScratch {
  const size = width * height;
  return {
    planes: [new Uint16Array(size), new Uint16Array(size), new Uint16Array(size)],
    columns: [new Uint32Array(width), new Uint32Array(width), new Uint32Array(width)],
    window: new Uint32Array(3),
    ids: new Int32Array(size),
    stack: new Int32Array(size),
    intermediate: new Uint8Array(size),
  };
}

/**
 * Replace each label with the most common label in a square window around it.
 *
 * Input: `labels` at `width` × `height`; `radius` in pixels. Output: `out`, written in place.
 *
 * Ties keep the pixel's own label, which stops shapes from crawling as the slider moves. The
 * window is clipped at the edges rather than padded, so borders are decided by real pixels only.
 *
 * Both passes read and write in row order. The vertical pass keeps a running total per column and
 * walks the image a row at a time rather than a column at a time — same arithmetic, but it avoids
 * the cache thrashing of a column-major walk over an image-sized array.
 */
export function majorityFilter(
  labels: ZoneMap,
  width: number,
  height: number,
  radius: number,
  scratch: SimplifyScratch,
  out: ZoneMap,
): ZoneMap {
  if (radius < 1) {
    out.set(labels);
    return out;
  }

  const [planeDark, planeMid, planeLight] = scratch.planes;
  const [colDark, colMid, colLight] = scratch.columns;

  // The window counts are indexed by label rather than branched on. Labels vary unpredictably
  // from pixel to pixel, so an if/else chain here costs more in mispredictions than the indexed
  // increment costs in memory traffic — measured at two to one, the wrong way round, when this
  // was written out per zone (NOTES.md).
  const window = scratch.window;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    window[0] = 0;
    window[1] = 0;
    window[2] = 0;
    for (let x = 0; x <= radius && x < width; x++) {
      window[labels[row + x]!]!++;
    }
    for (let x = 0; x < width; x++) {
      const i = row + x;
      planeDark[i] = window[0]!;
      planeMid[i] = window[1]!;
      planeLight[i] = window[2]!;

      const leaving = x - radius;
      if (leaving >= 0) {
        window[labels[row + leaving]!]!--;
      }
      const entering = x + radius + 1;
      if (entering < width) {
        window[labels[row + entering]!]!++;
      }
    }
  }

  colDark.fill(0);
  colMid.fill(0);
  colLight.fill(0);
  for (let y = 0; y <= radius && y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      colDark[x]! += planeDark[row + x]!;
      colMid[x]! += planeMid[row + x]!;
      colLight[x]! += planeLight[row + x]!;
    }
  }

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const dark = colDark[x]!;
      const mid = colMid[x]!;
      const light = colLight[x]!;
      const own = labels[i]!;

      // Strict `>` throughout, tested against the pixel's own count first, so a tie leaves the
      // label alone.
      let best = own;
      let bestCount = own === ZONE_DARK ? dark : own === ZONE_MID ? mid : light;
      if (dark > bestCount) {
        best = ZONE_DARK;
        bestCount = dark;
      }
      if (mid > bestCount) {
        best = ZONE_MID;
        bestCount = mid;
      }
      if (light > bestCount) {
        best = ZONE_LIGHT;
      }
      out[i] = best;
    }

    const leaving = y - radius;
    if (leaving >= 0) {
      const from = leaving * width;
      for (let x = 0; x < width; x++) {
        colDark[x]! -= planeDark[from + x]!;
        colMid[x]! -= planeMid[from + x]!;
        colLight[x]! -= planeLight[from + x]!;
      }
    }
    const entering = y + radius + 1;
    if (entering < height) {
      const from = entering * width;
      for (let x = 0; x < width; x++) {
        colDark[x]! += planeDark[from + x]!;
        colMid[x]! += planeMid[from + x]!;
        colLight[x]! += planeLight[from + x]!;
      }
    }
  }

  return out;
}

/** How many zones the study has. Not a parameter — see the module comment. */
const ZONE_COUNT = 3;

/**
 * Absorb regions below `minArea` into the zone that borders them most.
 *
 * Input: `labels` at `width` × `height`; `minArea` in pixels. Output: `out`, written in place.
 *
 * All reassignments are decided against the incoming labels and applied together, so absorbing
 * one region cannot change what its neighbour gets absorbed into. A region with no neighbour of a
 * different zone — the whole image being one value — keeps what it had.
 */
export function absorbSmallRegions(
  labels: ZoneMap,
  width: number,
  height: number,
  minArea: number,
  scratch: SimplifyScratch,
  out: ZoneMap,
): ZoneMap {
  if (out !== labels) {
    out.set(labels);
  }
  if (minArea < 2) {
    return out;
  }

  const { ids, areas, zones, count } = labelUniformRegions(
    labels,
    width,
    height,
    scratch.ids,
    scratch.stack,
  );

  let anySmall = false;
  for (let id = 0; id < count; id++) {
    if (areas[id]! < minArea) {
      anySmall = true;
      break;
    }
  }
  if (!anySmall) {
    return out;
  }

  const borders = new Uint32Array(count * ZONE_COUNT);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      const id = ids[i]!;
      if (areas[id]! >= minArea) {
        continue;
      }
      const base = id * ZONE_COUNT;
      if (x > 0) {
        borders[base + labels[i - 1]!]!++;
      }
      if (x < width - 1) {
        borders[base + labels[i + 1]!]!++;
      }
      if (y > 0) {
        borders[base + labels[i - width]!]!++;
      }
      if (y < height - 1) {
        borders[base + labels[i + width]!]!++;
      }
    }
  }

  const absorbInto = new Uint8Array(count);
  for (let id = 0; id < count; id++) {
    const zone = zones[id]!;
    let best = zone;
    let bestCount = 0;
    for (let z = 0; z < ZONE_COUNT; z++) {
      if (z !== zone && borders[id * ZONE_COUNT + z]! > bestCount) {
        best = z;
        bestCount = borders[id * ZONE_COUNT + z]!;
      }
    }
    absorbInto[id] = best;
  }

  for (let i = 0; i < out.length; i++) {
    const id = ids[i]!;
    if (areas[id]! < minArea) {
      out[i] = absorbInto[id]!;
    }
  }

  return out;
}

/**
 * How much a given depth counts as in focus, 0–1.
 *
 * A Gaussian centred on `focus`, falling away either side, so the sharp part of the picture is a
 * slab at a chosen distance rather than everything in front of a line — the same shape as a
 * camera's depth of field, and controllable the same way.
 */
export function focusWeight(depth: number, focus: number, falloff: number): number {
  if (falloff <= 0) {
    return depth === focus ? 1 : 0;
  }
  const d = (depth - focus) / falloff;
  return Math.exp(-0.5 * d * d);
}

/**
 * Put the detail back wherever the scene is in focus.
 *
 * Input: `simplified` and `detailed`, two label maps of the same image — the second being what the
 * first looked like before simplification; `depth` 0–1 where 1 is farthest; `focus`, the depth to
 * keep sharp; `falloff`, how fast sharpness is given up either side. Output: `out`, written in
 * place, and safe to alias either input since every pixel is decided independently.
 *
 * A painter simplifies the background and keeps the subject sharp, which no single simplification
 * strength can do because it treats the whole frame alike. This needs no second pass: both maps
 * already exist, so choosing between them per pixel is one walk over the image.
 *
 * The choice is a threshold on the Gaussian rather than a blend, because a zone label cannot be
 * half-simplified. What the falloff buys is a band with a near and a far edge, placed where the
 * painter wants it — not a soft transition.
 */
export function restoreDetail(
  simplified: ZoneMap,
  detailed: ZoneMap,
  depth: Float32Array,
  focus: number,
  falloff: number,
  out: ZoneMap,
): ZoneMap {
  for (let i = 0; i < out.length; i++) {
    out[i] =
      focusWeight(depth[i]!, focus, falloff) >= FOCUS_WEIGHT_THRESHOLD
        ? detailed[i]!
        : simplified[i]!;
  }
  return out;
}

/** Both stages, in order. */
export function simplifyLabels(
  labels: ZoneMap,
  width: number,
  height: number,
  settings: SimplifySettings,
  scratch: SimplifyScratch,
  out: ZoneMap,
): ZoneMap {
  majorityFilter(labels, width, height, settings.radius, scratch, scratch.intermediate);
  return absorbSmallRegions(
    scratch.intermediate,
    width,
    height,
    settings.minArea,
    scratch,
    out,
  );
}
