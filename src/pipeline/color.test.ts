import { describe, expect, it } from 'vitest';
import { labToSrgbPixel, srgbToLab } from './color';

/** Build a one-pixel-per-colour RGBA buffer. */
function pixels(...colours: Array<[number, number, number]>): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(colours.length * 4);
  colours.forEach(([r, g, b], i) => {
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  });
  return out;
}

describe('srgbToLab', () => {
  it('maps white to L = 100 with no chroma', () => {
    const { L, a, b } = srgbToLab(pixels([255, 255, 255]));
    expect(L[0]!).toBeCloseTo(100, 2);
    expect(a[0]!).toBeCloseTo(0, 2);
    expect(b[0]!).toBeCloseTo(0, 2);
  });

  it('maps black to L = 0 with no chroma', () => {
    const { L, a, b } = srgbToLab(pixels([0, 0, 0]));
    expect(L[0]!).toBeCloseTo(0, 4);
    expect(a[0]!).toBeCloseTo(0, 4);
    expect(b[0]!).toBeCloseTo(0, 4);
  });

  it('puts mid sRGB grey near L = 53, not L = 50', () => {
    // The whole point of working in LAB: 50% sRGB is not 50% lightness.
    const { L } = srgbToLab(pixels([128, 128, 128]));
    expect(L[0]!).toBeGreaterThan(53);
    expect(L[0]!).toBeLessThan(54);
  });

  it('keeps neutral greys free of chroma', () => {
    const { a, b } = srgbToLab(pixels([64, 64, 64], [128, 128, 128], [200, 200, 200]));
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(a[i]!)).toBeLessThan(0.01);
      expect(Math.abs(b[i]!)).toBeLessThan(0.01);
    }
  });

  it('signs the opponent axes the standard way', () => {
    const { a, b } = srgbToLab(pixels([255, 0, 0], [0, 0, 255]));
    expect(a[0]!).toBeGreaterThan(0); // red is +a
    expect(b[0]!).toBeGreaterThan(0); // and +b
    expect(b[1]!).toBeLessThan(0); // blue is −b
  });

  it('separates colours that RGB-average brightness confuses', () => {
    // Saturated blue and a mid grey have similar RGB averages but very different lightness. This
    // is the prototype's visible failure (ref/image_upload.js averages R, G and B).
    const [blue, grey] = [pixels([0, 0, 255]), pixels([85, 85, 85])];
    const blueAverage = (0 + 0 + 255) / 3;
    const greyAverage = 85;
    expect(blueAverage).toBeCloseTo(greyAverage, 0);
    expect(srgbToLab(blue).L[0]!).toBeLessThan(srgbToLab(grey).L[0]!);
  });

  it('produces one entry per pixel', () => {
    const { L, a, b } = srgbToLab(pixels([1, 2, 3], [4, 5, 6], [7, 8, 9]));
    expect([L.length, a.length, b.length]).toEqual([3, 3, 3]);
  });
});

describe('labToSrgbPixel', () => {
  it('round-trips in-gamut colours to within one byte', () => {
    const colours: Array<[number, number, number]> = [
      [0, 0, 0],
      [255, 255, 255],
      [128, 128, 128],
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [17, 94, 200],
      [201, 143, 76],
      [3, 250, 128],
    ];
    const { L, a, b } = srgbToLab(pixels(...colours));
    const out = new Uint8ClampedArray(colours.length * 4);

    for (let i = 0; i < colours.length; i++) {
      labToSrgbPixel(L[i]!, a[i]!, b[i]!, out, i * 4);
      const [r, g, bl] = colours[i]!;
      expect(Math.abs(out[i * 4]! - r)).toBeLessThanOrEqual(1);
      expect(Math.abs(out[i * 4 + 1]! - g)).toBeLessThanOrEqual(1);
      expect(Math.abs(out[i * 4 + 2]! - bl)).toBeLessThanOrEqual(1);
      expect(out[i * 4 + 3]!).toBe(255);
    }
  });

  it('clamps out-of-gamut chroma instead of wrapping', () => {
    const out = new Uint8ClampedArray(4);
    labToSrgbPixel(50, 200, -200, out, 0);
    for (let i = 0; i < 3; i++) {
      expect(out[i]!).toBeGreaterThanOrEqual(0);
      expect(out[i]!).toBeLessThanOrEqual(255);
    }
  });

  it('renders zero chroma as a neutral grey', () => {
    const out = new Uint8ClampedArray(4);
    labToSrgbPixel(50, 0, 0, out, 0);
    expect(out[0]!).toBe(out[1]!);
    expect(out[1]!).toBe(out[2]!);
  });

  it('writes at the given offset and leaves earlier bytes alone', () => {
    const out = new Uint8ClampedArray(8);
    labToSrgbPixel(100, 0, 0, out, 4);
    expect(Array.from(out.slice(0, 4))).toEqual([0, 0, 0, 0]);
    expect(out[4]!).toBe(255);
  });
});
