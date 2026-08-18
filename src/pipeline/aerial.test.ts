import { describe, expect, it } from 'vitest';
import { AERIAL_L_CEILING, HAZE_COLOUR } from '../constants';
import { distanceRamp, hazeDistance, liftDistance } from './aerial';

describe('distanceRamp', () => {
  it('is zero at and before the start', () => {
    expect(distanceRamp(0, 0.4)).toBe(0);
    expect(distanceRamp(0.4, 0.4)).toBe(0);
  });

  it('reaches one at the far end', () => {
    expect(distanceRamp(1, 0.4)).toBe(1);
  });

  it('rises linearly between', () => {
    expect(distanceRamp(0.7, 0.4)).toBeCloseTo(0.5, 6);
  });

  it('disables itself rather than dividing by zero when the start is at the far end', () => {
    expect(distanceRamp(1, 1)).toBe(0);
    expect(distanceRamp(0.5, 1.5)).toBe(0);
  });

  it('never leaves 0–1', () => {
    for (const depth of [-1, 0, 0.5, 1, 2]) {
      const t = distanceRamp(depth, 0.3);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
  });
});

describe('liftDistance', () => {
  const settings = { start: 0, strength: 1 };

  it('leaves everything alone at zero strength', () => {
    const L = Float32Array.from([10, 50, 90]);
    const out = new Float32Array(3);
    liftDistance(L, Float32Array.from([1, 1, 1]), { start: 0, strength: 0 }, 100, out);
    expect(Array.from(out)).toEqual([10, 50, 90]);
  });

  it('leaves near pixels untouched however strong the correction', () => {
    const out = new Float32Array(1);
    liftDistance(Float32Array.from([20]), Float32Array.from([0]), settings, 100, out);
    expect(out[0]!).toBe(20);
  });

  it('lifts the farthest pixels to the ceiling at full strength', () => {
    const out = new Float32Array(1);
    liftDistance(Float32Array.from([20]), Float32Array.from([1]), settings, 100, out);
    expect(out[0]!).toBeCloseTo(AERIAL_L_CEILING, 4);
  });

  it('moves a dark distant pixel further than a pale one', () => {
    const out = new Float32Array(2);
    liftDistance(
      Float32Array.from([10, 80]),
      Float32Array.from([1, 1]),
      { start: 0, strength: 0.5 },
      100,
      out,
    );
    expect(out[0]! - 10).toBeGreaterThan(out[1]! - 80);
  });

  it('never darkens anything', () => {
    const L = Float32Array.from([0, 25, 50, 75, 100]);
    const depth = Float32Array.from([0, 0.25, 0.5, 0.75, 1]);
    const out = new Float32Array(5);
    liftDistance(L, depth, { start: 0.2, strength: 0.8 }, 100, out);
    for (let i = 0; i < 5; i++) {
      expect(out[i]!).toBeGreaterThanOrEqual(L[i]!);
    }
  });

  it('keeps the result inside the L range', () => {
    const out = new Float32Array(3);
    liftDistance(
      Float32Array.from([0, 50, 100]),
      Float32Array.from([1, 1, 1]),
      { start: 0, strength: 1 },
      100,
      out,
    );
    expect(Array.from(out).every((v) => v >= 0 && v <= 100)).toBe(true);
  });

  it('leaves anything at or above the limit alone, however far away it is', () => {
    // A distant mid and a distant light must not move; only the darks are the problem.
    const L = Float32Array.from([20, 40, 80]);
    const depth = Float32Array.from([1, 1, 1]);
    const out = new Float32Array(3);
    liftDistance(L, depth, { start: 0, strength: 1 }, 40, out);
    expect(out[0]!).toBeGreaterThan(20);
    expect(out[1]!).toBe(40);
    expect(out[2]!).toBe(80);
  });

  it('can lift a dark clear of the boundary that selected it', () => {
    // The intended outcome: a distant dark stops being dark.
    const out = new Float32Array(1);
    liftDistance(Float32Array.from([15]), Float32Array.from([1]), { start: 0, strength: 0.8 }, 30, out);
    expect(out[0]!).toBeGreaterThan(30);
  });

  it('tests the limit against the incoming L, not the lifted one', () => {
    // Otherwise lifting the first pixel could change the verdict on the next.
    const L = Float32Array.from([10, 10]);
    const out = new Float32Array(2);
    liftDistance(L, Float32Array.from([1, 1]), { start: 0, strength: 1 }, 20, out);
    expect(out[0]!).toBe(out[1]!);
    expect(out[0]!).toBeGreaterThan(20);
  });

  it('does nothing before the start, so the painter can place the background', () => {
    const L = Float32Array.from([30, 30]);
    const depth = Float32Array.from([0.4, 0.9]);
    const out = new Float32Array(2);
    liftDistance(L, depth, { start: 0.5, strength: 1 }, 100, out);
    expect(out[0]!).toBe(30);
    expect(out[1]!).toBeGreaterThan(30);
  });
});

describe('hazeDistance', () => {
  /** One pixel of a given colour, with a given depth. */
  function haze(
    rgb: [number, number, number],
    depth: number,
    settings: { start: number; strength: number },
  ): number[] {
    const src = Uint8ClampedArray.from([...rgb, 255]);
    const out = new Uint8ClampedArray(4);
    hazeDistance(src, Float32Array.from([depth]), settings, out);
    return Array.from(out);
  }

  it('leaves the photo alone at zero strength', () => {
    expect(haze([200, 40, 40], 1, { start: 0, strength: 0 })).toEqual([200, 40, 40, 255]);
  });

  it('leaves near pixels untouched', () => {
    expect(haze([200, 40, 40], 0, { start: 0, strength: 1 })).toEqual([200, 40, 40, 255]);
  });

  it('takes the farthest pixels all the way to the haze colour at full strength', () => {
    const out = haze([200, 40, 40], 1, { start: 0, strength: 1 });
    expect(out[0]!).toBeCloseTo(HAZE_COLOUR[0], -1);
    expect(out[1]!).toBeCloseTo(HAZE_COLOUR[1], -1);
    expect(out[2]!).toBeCloseTo(HAZE_COLOUR[2], -1);
  });

  it('lightens a dark distant pixel', () => {
    const out = haze([30, 30, 30], 1, { start: 0, strength: 0.6 });
    expect(out[0]!).toBeGreaterThan(30);
  });

  it('drains colour from distance rather than only tinting it', () => {
    // A saturated red at moderate haze must lose saturation, not merely shift hue.
    const before = 200 - 40;
    const out = haze([200, 40, 40], 1, { start: 0, strength: 0.4 });
    const after = Math.max(...out.slice(0, 3)) - Math.min(...out.slice(0, 3));
    expect(after).toBeLessThan(before);
  });

  it('shifts distance towards blue', () => {
    const out = haze([120, 120, 120], 1, { start: 0, strength: 0.5 });
    expect(out[2]!).toBeGreaterThan(out[0]!);
  });

  it('leaves every pixel opaque', () => {
    expect(haze([10, 20, 30], 0.8, { start: 0.2, strength: 0.5 })[3]!).toBe(255);
  });

  it('does not modify the source', () => {
    const src = Uint8ClampedArray.from([200, 40, 40, 255]);
    const before = Array.from(src);
    hazeDistance(src, Float32Array.from([1]), { start: 0, strength: 1 }, new Uint8ClampedArray(4));
    expect(Array.from(src)).toEqual(before);
  });
});
