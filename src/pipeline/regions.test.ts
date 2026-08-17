import { describe, expect, it } from 'vitest';
import { countRegionsAtLeast, labelRegions, largestArea } from './regions';

/**
 * Build a zone map from rows of digits, so the shape under test is visible in the source.
 */
function mask(rows: string[]): { labels: Uint8Array; width: number; height: number } {
  const width = rows[0]!.length;
  const labels = new Uint8Array(width * rows.length);
  rows.forEach((row, y) => {
    for (let x = 0; x < width; x++) {
      labels[y * width + x] = Number(row[x]);
    }
  });
  return { labels, width, height: rows.length };
}

describe('labelRegions', () => {
  it('finds two separate regions of the requested zone', () => {
    const { labels, width, height } = mask([
      '11000',
      '11000',
      '00000',
      '00011',
      '00011',
    ]);
    const regions = labelRegions(labels, width, height, 1);
    expect(regions.count).toBe(2);
    expect(Array.from(regions.areas)).toEqual([4, 4]);
  });

  it('marks pixels outside the zone with −1', () => {
    const { labels, width, height } = mask(['101']);
    const regions = labelRegions(labels, width, height, 1);
    expect(Array.from(regions.ids)).toEqual([0, -1, 1]);
  });

  it('treats a diagonal touch as separate under 4-connectivity', () => {
    const { labels, width, height } = mask([
      '100',
      '010',
      '001',
    ]);
    expect(labelRegions(labels, width, height, 1, 4).count).toBe(3);
  });

  it('joins the same diagonal under 8-connectivity', () => {
    const { labels, width, height } = mask([
      '100',
      '010',
      '001',
    ]);
    const regions = labelRegions(labels, width, height, 1, 8);
    expect(regions.count).toBe(1);
    expect(Array.from(regions.areas)).toEqual([3]);
  });

  it('traces a shape that snakes back on itself in one pass', () => {
    const { labels, width, height } = mask([
      '11111',
      '00001',
      '11111',
      '10000',
      '11111',
    ]);
    const regions = labelRegions(labels, width, height, 1);
    expect(regions.count).toBe(1);
    expect(regions.areas[0]!).toBe(17);
  });

  it('finds nothing when the zone is absent', () => {
    const { labels, width, height } = mask(['000', '000']);
    const regions = labelRegions(labels, width, height, 1);
    expect(regions.count).toBe(0);
    expect(largestArea(regions)).toBe(0);
  });

  it('covers every pixel when the whole image is one zone', () => {
    const { labels, width, height } = mask(['222', '222']);
    const regions = labelRegions(labels, width, height, 2);
    expect(regions.count).toBe(1);
    expect(regions.areas[0]!).toBe(6);
  });

  it('handles a region large enough to overflow a recursive implementation', () => {
    const width = 400;
    const height = 400;
    const labels = new Uint8Array(width * height).fill(1);
    const regions = labelRegions(labels, width, height, 1);
    expect(regions.count).toBe(1);
    expect(regions.areas[0]!).toBe(width * height);
  });
});

describe('largestArea', () => {
  it('returns the biggest region, not the first', () => {
    const { labels, width, height } = mask([
      '10111',
      '00111',
    ]);
    expect(largestArea(labelRegions(labels, width, height, 1))).toBe(6);
  });
});

describe('countRegionsAtLeast', () => {
  it('ignores speckle below the minimum area', () => {
    const { labels, width, height } = mask([
      '11101',
      '11100',
      '00001',
    ]);
    const regions = labelRegions(labels, width, height, 1);
    expect(regions.count).toBe(3);
    expect(countRegionsAtLeast(regions, 2)).toBe(1);
  });

  it('counts everything when the minimum is one pixel', () => {
    const { labels, width, height } = mask(['101']);
    expect(countRegionsAtLeast(labelRegions(labels, width, height, 1), 1)).toBe(2);
  });
});
