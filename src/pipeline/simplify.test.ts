import { describe, expect, it } from 'vitest';
import {
  absorbSmallRegions,
  createSimplifyScratch,
  majorityFilter,
  restoreDetail,
  simplifyLabels,
  simplifySettings,
} from './simplify';
import { ZONE_DARK, ZONE_LIGHT, ZONE_MID } from './threshold';

/** Build a label map from rows of digits, so the shape under test is visible in the source. */
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

/** Render a label map back to rows of digits, for readable failures. */
function show(labels: Uint8Array, width: number): string[] {
  const rows: string[] = [];
  for (let y = 0; y < labels.length / width; y++) {
    rows.push(Array.from(labels.subarray(y * width, (y + 1) * width)).join(''));
  }
  return rows;
}

describe('simplifySettings', () => {
  it('does nothing at zero strength', () => {
    const { radius, minArea } = simplifySettings(0, 1000, 800);
    expect(radius).toBe(0);
    expect(minArea).toBe(0);
  });

  it('scales the window with the image, so a slider position means the same thing at any size', () => {
    const small = simplifySettings(1, 500, 400);
    const large = simplifySettings(1, 1000, 800);
    expect(large.radius).toBeCloseTo(small.radius * 2, 0);
    expect(large.minArea).toBeCloseTo(small.minArea * 4, 0);
  });

  it('clamps strengths outside 0–1', () => {
    expect(simplifySettings(-1, 800, 600).radius).toBe(0);
    expect(simplifySettings(5, 800, 600)).toEqual(simplifySettings(1, 800, 600));
  });
});

describe('majorityFilter', () => {
  it('passes the labels straight through below radius 1', () => {
    const { labels, width, height } = mask(['010', '101']);
    const out = new Uint8Array(labels.length);
    majorityFilter(labels, width, height, 0, createSimplifyScratch(width, height), out);
    expect(Array.from(out)).toEqual(Array.from(labels));
  });

  it('removes an isolated speck', () => {
    const { labels, width, height } = mask([
      '00000',
      '00000',
      '00100',
      '00000',
      '00000',
    ]);
    const out = new Uint8Array(labels.length);
    majorityFilter(labels, width, height, 1, createSimplifyScratch(width, height), out);
    expect(show(out, width)).toEqual(['00000', '00000', '00000', '00000', '00000']);
  });

  it('fills a pinhole', () => {
    const { labels, width, height } = mask([
      '22222',
      '22222',
      '22022',
      '22222',
      '22222',
    ]);
    const out = new Uint8Array(labels.length);
    majorityFilter(labels, width, height, 1, createSimplifyScratch(width, height), out);
    expect(show(out, width)).toEqual(['22222', '22222', '22222', '22222', '22222']);
  });

  it('leaves a shape larger than the window alone in its interior', () => {
    const { labels, width, height } = mask([
      '000000',
      '011110',
      '011110',
      '011110',
      '011110',
      '000000',
    ]);
    const out = new Uint8Array(labels.length);
    majorityFilter(labels, width, height, 1, createSimplifyScratch(width, height), out);
    // The 4×4 block survives; only its corners, where the window sees more background, round off.
    expect(out[2 * width + 2]!).toBe(1);
    expect(out[3 * width + 3]!).toBe(1);
  });

  it('keeps the pixel own label when the window ties', () => {
    // Half dark, half light, split down the middle: every window on the seam is an even split.
    const { labels, width, height } = mask(['0022', '0022', '0022', '0022']);
    const out = new Uint8Array(labels.length);
    majorityFilter(labels, width, height, 1, createSimplifyScratch(width, height), out);
    expect(show(out, width)).toEqual(['0022', '0022', '0022', '0022']);
  });

  it('decides edge pixels from real neighbours rather than padding', () => {
    const { labels, width, height } = mask(['111', '111', '111']);
    const out = new Uint8Array(labels.length);
    majorityFilter(labels, width, height, 2, createSimplifyScratch(width, height), out);
    expect(Array.from(out).every((label) => label === ZONE_MID)).toBe(true);
  });

  it('produces only labels that were already present', () => {
    const { labels, width, height } = mask([
      '00220022',
      '02200220',
      '22002200',
      '20022002',
    ]);
    const out = new Uint8Array(labels.length);
    majorityFilter(labels, width, height, 2, createSimplifyScratch(width, height), out);
    expect(Array.from(out).every((label) => label === ZONE_DARK || label === ZONE_LIGHT)).toBe(
      true,
    );
  });
});

describe('absorbSmallRegions', () => {
  it('leaves the map alone below a minimum area of two', () => {
    const { labels, width, height } = mask(['010', '000']);
    const out = new Uint8Array(labels.length);
    absorbSmallRegions(labels, width, height, 1, createSimplifyScratch(width, height), out);
    expect(Array.from(out)).toEqual(Array.from(labels));
  });

  it('absorbs an island into the zone surrounding it', () => {
    const { labels, width, height } = mask([
      '00000',
      '00000',
      '00200',
      '00000',
      '00000',
    ]);
    const out = new Uint8Array(labels.length);
    absorbSmallRegions(labels, width, height, 4, createSimplifyScratch(width, height), out);
    expect(Array.from(out).every((label) => label === ZONE_DARK)).toBe(true);
  });

  it('picks the neighbour it shares the most border with', () => {
    // The single mid pixel touches light on three sides and dark on one.
    const { labels, width, height } = mask([
      '02220',
      '02120',
      '02220',
    ]);
    const out = new Uint8Array(labels.length);
    absorbSmallRegions(labels, width, height, 2, createSimplifyScratch(width, height), out);
    expect(out[1 * width + 2]!).toBe(ZONE_LIGHT);
  });

  it('keeps regions at or above the minimum area', () => {
    const { labels, width, height } = mask([
      '000000',
      '022000',
      '022000',
      '000000',
    ]);
    const out = new Uint8Array(labels.length);
    absorbSmallRegions(labels, width, height, 4, createSimplifyScratch(width, height), out);
    expect(show(out, width)).toEqual(['000000', '022000', '022000', '000000']);
  });

  it('decides every region against the incoming map, not a half-updated one', () => {
    // Two single-pixel mid specks side by side. Each must be judged against the darks around
    // them, not against whatever the other one just became.
    const { labels, width, height } = mask([
      '00000',
      '01010',
      '00000',
    ]);
    const out = new Uint8Array(labels.length);
    absorbSmallRegions(labels, width, height, 2, createSimplifyScratch(width, height), out);
    expect(Array.from(out).every((label) => label === ZONE_DARK)).toBe(true);
  });

  it('leaves a single-region image alone rather than inventing a zone for it', () => {
    const { labels, width, height } = mask(['111', '111']);
    const out = new Uint8Array(labels.length);
    absorbSmallRegions(labels, width, height, 100, createSimplifyScratch(width, height), out);
    expect(Array.from(out).every((label) => label === ZONE_MID)).toBe(true);
  });
});

describe('simplifyLabels', () => {
  it('runs both stages, leaving fewer separate shapes than it started with', () => {
    const { labels, width, height } = mask([
      '0000000000',
      '0020000200',
      '0000000000',
      '0022220000',
      '0022220000',
      '0022220000',
      '0000002000',
      '0000000000',
    ]);
    const out = new Uint8Array(labels.length);
    simplifyLabels(
      labels,
      width,
      height,
      { radius: 1, minArea: 3 },
      createSimplifyScratch(width, height),
      out,
    );

    // The specks are gone and the block survives.
    expect(out[1 * width + 2]!).toBe(ZONE_DARK);
    expect(out[1 * width + 7]!).toBe(ZONE_DARK);
    expect(out[6 * width + 6]!).toBe(ZONE_DARK);
    expect(out[4 * width + 3]!).toBe(ZONE_LIGHT);
  });

  it('does not touch the input buffer', () => {
    const { labels, width, height } = mask(['0020', '0000']);
    const before = Array.from(labels);
    const out = new Uint8Array(labels.length);
    simplifyLabels(
      labels,
      width,
      height,
      { radius: 1, minArea: 2 },
      createSimplifyScratch(width, height),
      out,
    );
    expect(Array.from(labels)).toEqual(before);
  });
});

describe('restoreDetail', () => {
  it('keeps the simplified map where the scene is far', () => {
    const simplified = Uint8Array.from([2, 2, 2]);
    const detailed = Uint8Array.from([0, 1, 2]);
    const out = new Uint8Array(3);
    restoreDetail(simplified, detailed, Float32Array.from([1, 1, 1]), 0.4, out);
    expect(Array.from(out)).toEqual([2, 2, 2]);
  });

  it('puts the detail back where the scene is near', () => {
    const simplified = Uint8Array.from([2, 2, 2]);
    const detailed = Uint8Array.from([0, 1, 2]);
    const out = new Uint8Array(3);
    restoreDetail(simplified, detailed, Float32Array.from([0, 0, 0]), 0.4, out);
    expect(Array.from(out)).toEqual([0, 1, 2]);
  });

  it('splits at the limit, exclusive of it', () => {
    const simplified = Uint8Array.from([2, 2, 2]);
    const detailed = Uint8Array.from([0, 0, 0]);
    const out = new Uint8Array(3);
    restoreDetail(simplified, detailed, Float32Array.from([0.39, 0.4, 0.41]), 0.4, out);
    expect(Array.from(out)).toEqual([0, 2, 2]);
  });

  it('decides each pixel independently, so it may write into its own input', () => {
    const simplified = Uint8Array.from([2, 2, 2, 2]);
    const detailed = Uint8Array.from([0, 1, 0, 1]);
    restoreDetail(simplified, detailed, Float32Array.from([0, 1, 0, 1]), 0.5, simplified);
    expect(Array.from(simplified)).toEqual([0, 2, 0, 2]);
  });

  it('leaves the map untouched when nothing is near enough', () => {
    const simplified = Uint8Array.from([1, 1]);
    const detailed = Uint8Array.from([0, 0]);
    const out = new Uint8Array(2);
    restoreDetail(simplified, detailed, Float32Array.from([0.5, 0.9]), 0, out);
    expect(Array.from(out)).toEqual([1, 1]);
  });
});
