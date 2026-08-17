import { describe, expect, it } from 'vitest';
import {
  buildHistogram,
  lToPercentile,
  percentilesToCuts,
  percentileToL,
  scoreCandidate,
  suggestPercentiles,
} from './histogram';
import { thresholdL, ZONE_DARK, ZONE_LIGHT, ZONE_MID } from './threshold';

/** An image whose L values are spread evenly over 0–100. */
function evenRamp(count: number): Float32Array {
  return Float32Array.from({ length: count }, (_, i) => (i / (count - 1)) * 100);
}

describe('buildHistogram', () => {
  it('counts every pixel exactly once', () => {
    const hist = buildHistogram(evenRamp(1000), 256);
    expect(hist.reduce((sum, n) => sum + n, 0)).toBe(1000);
  });

  it('puts a flat ramp in every bin', () => {
    const hist = buildHistogram(evenRamp(10_000), 100);
    expect(Array.from(hist).every((n) => n > 0)).toBe(true);
  });

  it('clamps values outside 0–100 into the end bins rather than dropping them', () => {
    const hist = buildHistogram(Float32Array.from([-20, 0, 100, 140]), 10);
    expect(hist[0]!).toBe(2);
    expect(hist[9]!).toBe(2);
    expect(hist.reduce((sum, n) => sum + n, 0)).toBe(4);
  });

  it('puts a single-valued image entirely in one bin', () => {
    const hist = buildHistogram(new Float32Array(50).fill(40), 100);
    expect(hist[40]!).toBe(50);
  });
});

describe('percentileToL', () => {
  const hist = buildHistogram(evenRamp(10_000), 256);

  it('pins the ends of the scale', () => {
    expect(percentileToL(hist, 0)).toBe(0);
    expect(percentileToL(hist, 100)).toBe(100);
  });

  it('never goes backwards as the percentile rises', () => {
    let previous = -1;
    for (let p = 0; p <= 100; p += 1) {
      const l = percentileToL(hist, p);
      expect(l).toBeGreaterThanOrEqual(previous);
      previous = l;
    }
  });

  it('maps a flat distribution roughly onto itself', () => {
    expect(percentileToL(hist, 25)).toBeCloseTo(25, 0);
    expect(percentileToL(hist, 50)).toBeCloseTo(50, 0);
    expect(percentileToL(hist, 75)).toBeCloseTo(75, 0);
  });

  it('follows the image rather than the scale for a skewed distribution', () => {
    // A dark photo: most pixels below L = 20. The median must land there too, which is the whole
    // reason the sliders are percentiles rather than absolute L (SPEC.md §6.4).
    const dark = Float32Array.from([
      ...Array(900).fill(10),
      ...Array(100).fill(90),
    ]);
    expect(percentileToL(buildHistogram(dark, 256), 50)).toBeLessThan(20);
  });

  it('falls back to a linear mapping for an empty histogram', () => {
    expect(percentileToL(new Uint32Array(256), 40)).toBeCloseTo(40, 5);
  });
});

describe('lToPercentile', () => {
  const hist = buildHistogram(evenRamp(10_000), 256);

  it('pins the ends of the scale', () => {
    expect(lToPercentile(hist, 0)).toBe(0);
    expect(lToPercentile(hist, 100)).toBe(100);
  });

  it('inverts percentileToL to within a bin', () => {
    for (const p of [10, 30, 50, 70, 90]) {
      expect(lToPercentile(hist, percentileToL(hist, p))).toBeCloseTo(p, 0);
    }
  });

  it('reports how much of a skewed image sits below a value', () => {
    const dark = Float32Array.from([...Array(800).fill(10), ...Array(200).fill(90)]);
    expect(lToPercentile(buildHistogram(dark, 256), 50)).toBeCloseTo(80, 0);
  });
});

describe('percentilesToCuts', () => {
  it('converts both boundaries through the same histogram', () => {
    const hist = buildHistogram(evenRamp(10_000), 256);
    const cuts = percentilesToCuts(hist, { dark: 20, light: 80 });
    expect(cuts.dark).toBeCloseTo(20, 0);
    expect(cuts.light).toBeCloseTo(80, 0);
  });

  it('keeps ordered percentiles ordered on the L scale', () => {
    const hist = buildHistogram(Float32Array.from([5, 5, 5, 5, 95]), 256);
    const cuts = percentilesToCuts(hist, { dark: 30, light: 90 });
    expect(cuts.dark).toBeLessThanOrEqual(cuts.light);
  });
});

describe('scoreCandidate', () => {
  /** A 40×40 label map, filled by a predicate on (x, y). */
  function labelMap(fill: (x: number, y: number) => number): Uint8Array {
    const out = new Uint8Array(40 * 40);
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        out[y * 40 + x] = fill(x, y);
      }
    }
    return out;
  }

  it('prefers one connected mid shape over the same area scattered', () => {
    const connected = labelMap((x, y) =>
      y < 6 ? ZONE_DARK : x < 20 ? ZONE_MID : ZONE_LIGHT,
    );
    const scattered = labelMap((x, y) =>
      y < 6 ? ZONE_DARK : (x + y) % 2 === 0 ? ZONE_MID : ZONE_LIGHT,
    );
    expect(scoreCandidate(connected, 40, 40)).toBeGreaterThan(
      scoreCandidate(scattered, 40, 40),
    );
  });

  it('prefers some darks over none', () => {
    const withDarks = labelMap((_x, y) => (y < 5 ? ZONE_DARK : y < 25 ? ZONE_MID : ZONE_LIGHT));
    const withoutDarks = labelMap((_x, y) => (y < 25 ? ZONE_MID : ZONE_LIGHT));
    expect(scoreCandidate(withDarks, 40, 40)).toBeGreaterThan(
      scoreCandidate(withoutDarks, 40, 40),
    );
  });

  it('prefers restrained darks over a mostly dark image', () => {
    const restrained = labelMap((_x, y) => (y < 5 ? ZONE_DARK : y < 25 ? ZONE_MID : ZONE_LIGHT));
    const heavy = labelMap((_x, y) => (y < 30 ? ZONE_DARK : ZONE_MID));
    expect(scoreCandidate(restrained, 40, 40)).toBeGreaterThan(scoreCandidate(heavy, 40, 40));
  });

  it('gives an image with no mid values a poor score', () => {
    const noMids = labelMap((_x, y) => (y < 20 ? ZONE_DARK : ZONE_LIGHT));
    const balanced = labelMap((_x, y) => (y < 5 ? ZONE_DARK : y < 25 ? ZONE_MID : ZONE_LIGHT));
    expect(scoreCandidate(noMids, 40, 40)).toBeLessThan(scoreCandidate(balanced, 40, 40));
  });
});

describe('suggestPercentiles', () => {
  /** Three broad value masses, the shape a landscape photo tends to have. */
  function threeBandImage(width: number, height: number): Float32Array {
    const out = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      const value = y < height * 0.15 ? 12 : y < height * 0.6 ? 45 : 85;
      out.fill(value, y * width, (y + 1) * width);
    }
    return out;
  }

  it('returns ordered boundaries inside the percentile range', () => {
    const image = threeBandImage(120, 90);
    const { dark, light } = suggestPercentiles(image, 120, 90);
    expect(dark).toBeGreaterThanOrEqual(0);
    expect(light).toBeLessThanOrEqual(100);
    expect(dark).toBeLessThan(light);
  });

  it('finds boundaries that separate an image built from three value masses', () => {
    // Asserted on the resulting zones rather than on the percentile numbers: where an image has
    // only a few distinct values, a whole range of percentiles maps to the same L cut and
    // produces exactly the same study. The labelling is what the painter sees.
    const image = threeBandImage(120, 90);
    const suggestion = suggestPercentiles(image, 120, 90);
    const labels = new Uint8Array(image.length);
    thresholdL(image, percentilesToCuts(buildHistogram(image, 256), suggestion), labels);

    const fractionOf = (zone: number): number =>
      labels.reduce((n, label) => (label === zone ? n + 1 : n), 0) / labels.length;

    // The bands occupy 15% / 45% / 40% of the frame and the study should recover that split.
    expect(fractionOf(ZONE_DARK)).toBeCloseTo(0.15, 1);
    expect(fractionOf(ZONE_MID)).toBeCloseTo(0.45, 1);
    expect(fractionOf(ZONE_LIGHT)).toBeCloseTo(0.4, 1);
  });

  it('does not fall over on a flat image', () => {
    const flat = new Float32Array(60 * 60).fill(50);
    const { dark, light } = suggestPercentiles(flat, 60, 60);
    expect(Number.isFinite(dark)).toBe(true);
    expect(Number.isFinite(light)).toBe(true);
    expect(dark).toBeLessThanOrEqual(light);
  });
});
