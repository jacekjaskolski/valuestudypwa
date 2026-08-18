import { describe, expect, it } from 'vitest';
import { normalizeDepth, renderDepth, resampleBilinear } from './depth';

describe('normalizeDepth', () => {
  it('maps the range onto 0–1', () => {
    const out = new Float32Array(3);
    normalizeDepth(Float32Array.from([10, 20, 30]), false, out);
    expect(Array.from(out)).toEqual([0, 0.5, 1]);
  });

  it('inverts when the model runs high for near, so 1 is farthest', () => {
    const out = new Float32Array(3);
    normalizeDepth(Float32Array.from([10, 20, 30]), true, out);
    expect(Array.from(out)).toEqual([1, 0.5, 0]);
  });

  it('is indifferent to the scale the model happens to use', () => {
    const small = new Float32Array(3);
    const large = new Float32Array(3);
    normalizeDepth(Float32Array.from([0.001, 0.002, 0.003]), false, small);
    normalizeDepth(Float32Array.from([1000, 2000, 3000]), false, large);
    expect(Array.from(small)).toEqual(Array.from(large));
  });

  it('handles negative values', () => {
    const out = new Float32Array(3);
    normalizeDepth(Float32Array.from([-5, 0, 5]), false, out);
    expect(Array.from(out)).toEqual([0, 0.5, 1]);
  });

  it('treats a flat map as all near, so a failed model corrects nothing', () => {
    const out = new Float32Array(4);
    normalizeDepth(new Float32Array(4).fill(7), true, out);
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
  });

  it('stays within 0–1 throughout', () => {
    const raw = Float32Array.from({ length: 50 }, (_, i) => Math.sin(i) * 100);
    const out = new Float32Array(50);
    normalizeDepth(raw, true, out);
    expect(Array.from(out).every((v) => v >= 0 && v <= 1)).toBe(true);
  });
});

describe('resampleBilinear', () => {
  it('returns the same image at the same size', () => {
    const src = Float32Array.from([1, 2, 3, 4]);
    const dst = new Float32Array(4);
    resampleBilinear(src, 2, 2, dst, 2, 2);
    expect(Array.from(dst)).toEqual([1, 2, 3, 4]);
  });

  it('interpolates between samples when magnifying', () => {
    const src = Float32Array.from([0, 10]);
    const dst = new Float32Array(4);
    resampleBilinear(src, 2, 1, dst, 4, 1);
    // Sample centres land inside the source, so the middle two are interpolated, not copied.
    expect(dst[0]!).toBe(0);
    expect(dst[3]!).toBe(10);
    expect(dst[1]!).toBeGreaterThan(0);
    expect(dst[1]!).toBeLessThan(dst[2]!);
  });

  it('holds a flat map flat, including at the edges', () => {
    const src = new Float32Array(9).fill(0.42);
    const dst = new Float32Array(400);
    resampleBilinear(src, 3, 3, dst, 20, 20);
    expect(Array.from(dst).every((v) => Math.abs(v - 0.42) < 1e-6)).toBe(true);
  });

  it('keeps a gradient monotonic across the whole width', () => {
    const src = Float32Array.from([0, 1, 2, 3]);
    const dst = new Float32Array(16);
    resampleBilinear(src, 4, 1, dst, 16, 1);
    for (let i = 1; i < 16; i++) {
      expect(dst[i]!).toBeGreaterThanOrEqual(dst[i - 1]!);
    }
  });

  it('stays inside the source range, so normalised depth stays normalised', () => {
    const src = Float32Array.from([0, 1, 1, 0]);
    const dst = new Float32Array(2500);
    resampleBilinear(src, 2, 2, dst, 50, 50);
    expect(Math.min(...dst)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...dst)).toBeLessThanOrEqual(1);
  });

  it('does not mirror the image', () => {
    // A left-dark, right-light source must stay that way round.
    const src = Float32Array.from([0, 0, 1, 1]);
    const dst = new Float32Array(8);
    resampleBilinear(src, 4, 1, dst, 8, 1);
    expect(dst[0]!).toBeLessThan(dst[7]!);
  });
});

describe('renderDepth', () => {
  it('paints far as white and near as black', () => {
    const out = new Uint8ClampedArray(8);
    renderDepth(Float32Array.from([0, 1]), out);
    expect(Array.from(out.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(out.slice(4, 8))).toEqual([255, 255, 255, 255]);
  });

  it('is neutral at every pixel', () => {
    const out = new Uint8ClampedArray(12);
    renderDepth(Float32Array.from([0.25, 0.5, 0.75]), out);
    for (let p = 0; p < 12; p += 4) {
      expect(out[p]!).toBe(out[p + 1]!);
      expect(out[p + 1]!).toBe(out[p + 2]!);
      expect(out[p + 3]!).toBe(255);
    }
  });
});
