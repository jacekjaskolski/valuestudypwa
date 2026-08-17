import { describe, expect, it } from 'vitest';
import { labToSrgbPixel } from './color';
import { renderZones } from './render';
import { ZONE_DARK, ZONE_LIGHT, ZONE_MID } from './threshold';

const ZONE_L = [12, 50, 88] as const;

function render(
  labels: number[],
  a: number[],
  b: number[],
  greyscale: boolean,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(labels.length * 4);
  renderZones(
    Uint8Array.from(labels),
    Float32Array.from(a),
    Float32Array.from(b),
    ZONE_L,
    { greyscale },
    out,
  );
  return out;
}

/** What one LAB triple should come out as, straight from the converter. */
function expected(L: number, a: number, b: number): number[] {
  const out = new Uint8ClampedArray(4);
  labToSrgbPixel(L, a, b, out, 0);
  return Array.from(out);
}

describe('renderZones', () => {
  it('paints each label at its zone lightness, keeping the source chroma', () => {
    const out = render([ZONE_DARK, ZONE_MID, ZONE_LIGHT], [20, 20, 20], [-30, -30, -30], false);
    expect(Array.from(out.slice(0, 4))).toEqual(expected(ZONE_L[0], 20, -30));
    expect(Array.from(out.slice(4, 8))).toEqual(expected(ZONE_L[1], 20, -30));
    expect(Array.from(out.slice(8, 12))).toEqual(expected(ZONE_L[2], 20, -30));
  });

  it('gives pixels in the same zone the same lightness but different colour', () => {
    const out = render([ZONE_MID, ZONE_MID], [40, -40], [40, -40], false);
    const first = Array.from(out.slice(0, 3));
    const second = Array.from(out.slice(4, 7));
    expect(first).not.toEqual(second);
  });

  it('ignores a and b in greyscale mode', () => {
    const tinted = render([ZONE_DARK, ZONE_MID, ZONE_LIGHT], [60, -60, 30], [-60, 60, 10], true);
    const neutral = render([ZONE_DARK, ZONE_MID, ZONE_LIGHT], [0, 0, 0], [0, 0, 0], true);
    expect(Array.from(tinted)).toEqual(Array.from(neutral));
  });

  it('produces exactly three distinct neutral greys in greyscale mode', () => {
    const out = render([ZONE_DARK, ZONE_MID, ZONE_LIGHT], [10, 10, 10], [10, 10, 10], true);
    for (let i = 0; i < 3; i++) {
      expect(out[i * 4]!).toBe(out[i * 4 + 1]!);
      expect(out[i * 4 + 1]!).toBe(out[i * 4 + 2]!);
    }
    expect(out[0]!).toBeLessThan(out[4]!);
    expect(out[4]!).toBeLessThan(out[8]!);
  });

  it('does not crush the extremes to pure black and white', () => {
    // SPEC.md §6.6: 0/128/255 crushes the ends and reads harder than any painting could be.
    const out = render([ZONE_DARK, ZONE_LIGHT], [0, 0], [0, 0], true);
    expect(out[0]!).toBeGreaterThan(0);
    expect(out[4]!).toBeLessThan(255);
  });

  it('writes an opaque alpha for every pixel', () => {
    const out = render([ZONE_DARK, ZONE_MID], [5, 5], [5, 5], false);
    expect(out[3]!).toBe(255);
    expect(out[7]!).toBe(255);
  });
});
