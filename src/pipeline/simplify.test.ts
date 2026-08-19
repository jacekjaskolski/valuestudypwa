import { describe, expect, it } from 'vitest';
import {
  absorbSmallRegions,
  createSimplifyScratch,
  focusWeight,
  gradeDetail,
  majorityFilter,
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

describe('focusWeight', () => {
  it('is one exactly at the focus depth', () => {
    expect(focusWeight(0.4, 0.4, 0.2)).toBe(1);
  });

  it('falls away either side, symmetrically', () => {
    const near = focusWeight(0.2, 0.5, 0.2);
    const far = focusWeight(0.8, 0.5, 0.2);
    expect(near).toBeCloseTo(far, 6);
    expect(near).toBeLessThan(1);
  });

  it('falls faster with a tighter falloff', () => {
    expect(focusWeight(0.7, 0.5, 0.1)).toBeLessThan(focusWeight(0.7, 0.5, 0.3));
  });

  it('stays within 0–1', () => {
    for (const d of [0, 0.25, 0.5, 0.75, 1]) {
      const w = focusWeight(d, 0.5, 0.2);
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });

  it('degenerates to an exact match rather than dividing by zero', () => {
    expect(focusWeight(0.5, 0.5, 0)).toBe(1);
    expect(focusWeight(0.6, 0.5, 0)).toBe(0);
  });
});

describe('gradeDetail', () => {
  const sharp = () => Uint8Array.from([0, 0, 0, 0, 0]);
  const mid = () => Uint8Array.from([1, 1, 1, 1, 1]);
  const soft = () => Uint8Array.from([2, 2, 2, 2, 2]);
  const depths = Float32Array.from([0, 0.25, 0.5, 0.75, 1]);

  it('takes the sharpest map at the focus depth and the softest far from it', () => {
    const out = new Uint8Array(5);
    gradeDetail([sharp(), soft()], depths, 0.25, 0.18, out);
    expect(out[1]!).toBe(0);
    expect(out[4]!).toBe(2);
  });

  it('passes through the middle levels rather than cutting straight over', () => {
    // The point of the extra levels: somewhere between in focus and out of it, the pixel takes a
    // partly simplified map instead of jumping from one extreme to the other.
    const out = new Uint8Array(5);
    gradeDetail([sharp(), mid(), soft()], depths, 0, 0.5, out);
    expect(Array.from(out)).toContain(1);
  });

  it('never skips a step as the depth walks away from focus', () => {
    const wide = Float32Array.from({ length: 40 }, (_, i) => i / 39);
    const out = new Uint8Array(40);
    gradeDetail(
      [new Uint8Array(40).fill(0), new Uint8Array(40).fill(1), new Uint8Array(40).fill(2)],
      wide,
      0,
      0.4,
      out,
    );
    for (let i = 1; i < 40; i++) {
      expect(out[i]! - out[i - 1]!).toBeLessThanOrEqual(1);
    }
  });

  it('moves the sharp band when the focus moves', () => {
    const near = new Uint8Array(5);
    gradeDetail([sharp(), soft()], depths, 0, 0.18, near);
    const far = new Uint8Array(5);
    gradeDetail([sharp(), soft()], depths, 1, 0.18, far);
    expect(near[0]!).toBe(0);
    expect(near[4]!).toBe(2);
    expect(far[0]!).toBe(2);
    expect(far[4]!).toBe(0);
  });

  it('gives the band a far edge as well as a near one, unlike a cutoff', () => {
    const out = new Uint8Array(5);
    gradeDetail([sharp(), soft()], depths, 0.5, 0.12, out);
    expect(out[0]!).toBe(2);
    expect(out[2]!).toBe(0);
    expect(out[4]!).toBe(2);
  });

  it('widens the band with the falloff', () => {
    const tight = new Uint8Array(5);
    gradeDetail([sharp(), soft()], depths, 0.5, 0.05, tight);
    const loose = new Uint8Array(5);
    gradeDetail([sharp(), soft()], depths, 0.5, 0.6, loose);
    const sharpCount = (m: Uint8Array): number => Array.from(m).filter((v) => v === 0).length;
    expect(sharpCount(loose)).toBeGreaterThan(sharpCount(tight));
  });

  it('decides each pixel independently, so it may write into one of its own levels', () => {
    const softest = Uint8Array.from([2, 2]);
    gradeDetail([Uint8Array.from([0, 0]), softest], Float32Array.from([0, 1]), 0, 0.18, softest);
    expect(Array.from(softest)).toEqual([0, 2]);
  });

  it('copies through when given a single level', () => {
    const out = new Uint8Array(2);
    gradeDetail([Uint8Array.from([1, 2])], Float32Array.from([0, 1]), 0, 0.18, out);
    expect(Array.from(out)).toEqual([1, 2]);
  });
});
