/**
 * Connected-component labelling on a zone map.
 *
 * Written for the default-threshold scorer (SPEC.md §6.4), which needs to know how well a
 * candidate pair of boundaries holds the mid values together. Small-region removal (§6.5) needs
 * exactly the same information, so it reuses this.
 *
 * Pure: typed arrays in, typed arrays out.
 */

import type { ZoneMap } from './threshold';

export interface Regions {
  /** Region id for each pixel of the requested zone; −1 for pixels outside it. */
  ids: Int32Array;
  /** Area in pixels, indexed by region id. */
  areas: Uint32Array;
  /** Number of regions found. */
  count: number;
}

export type Connectivity = 4 | 8;

/** Neighbour offsets as [dx, dy], four-connected first. */
const NEIGHBOURS_4: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

const NEIGHBOURS_8: ReadonlyArray<readonly [number, number]> = [
  ...NEIGHBOURS_4,
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

/**
 * Find the connected regions of one zone.
 *
 * Input: `labels`, one byte per pixel, in row-major order at `width` × `height`; `zone`, the label
 * to trace. Output: per-pixel region ids and per-region pixel areas.
 *
 * Iterative flood fill — a photo-sized region would blow the call stack in a recursive version.
 */
export function labelRegions(
  labels: ZoneMap,
  width: number,
  height: number,
  zone: number,
  connectivity: Connectivity = 4,
): Regions {
  const size = width * height;
  const ids = new Int32Array(size).fill(-1);
  const areas: number[] = [];
  const stack = new Int32Array(size);
  const neighbours = connectivity === 8 ? NEIGHBOURS_8 : NEIGHBOURS_4;

  let count = 0;

  for (let start = 0; start < size; start++) {
    if (labels[start] !== zone || ids[start] !== -1) {
      continue;
    }

    const id = count++;
    let top = 0;
    let area = 0;
    stack[top++] = start;
    ids[start] = id;

    while (top > 0) {
      const p = stack[--top]!;
      area++;
      const x = p % width;
      const y = (p - x) / width;

      for (const [dx, dy] of neighbours) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          continue;
        }
        const n = ny * width + nx;
        if (labels[n] === zone && ids[n] === -1) {
          ids[n] = id;
          stack[top++] = n;
        }
      }
    }

    areas.push(area);
  }

  return { ids, areas: Uint32Array.from(areas), count };
}

/**
 * Area of the largest region, in pixels. Zero when the zone is empty.
 */
export function largestArea(regions: Regions): number {
  let largest = 0;
  for (let i = 0; i < regions.areas.length; i++) {
    const area = regions.areas[i]!;
    if (area > largest) {
      largest = area;
    }
  }
  return largest;
}

/**
 * How many regions are at least `minArea` pixels. Counting every region would be dominated by
 * single-pixel speckle, which shape simplification is going to remove anyway.
 */
export function countRegionsAtLeast(regions: Regions, minArea: number): number {
  let count = 0;
  for (let i = 0; i < regions.areas.length; i++) {
    if (regions.areas[i]! >= minArea) {
      count++;
    }
  }
  return count;
}
