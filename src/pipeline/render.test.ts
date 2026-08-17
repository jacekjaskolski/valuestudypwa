import { describe, expect, it } from 'vitest';
import { labToSrgbPixel } from './color';
import { buildZoneColours, renderFlat, renderZones } from './render';
import { ZONE_DARK, ZONE_LIGHT, ZONE_MID } from './threshold';

const ZONE_L = [12, 50, 88] as const;

function tinted(labels: number[], a: number[], b: number[]): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(labels.length * 4);
  const colours = buildZoneColours(Float32Array.from(a), Float32Array.from(b), [...ZONE_L]);
  renderZones(Uint8Array.from(labels), colours, out);
  return out;
}

function flat(labels: number[]): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(labels.length * 4);
  renderFlat(Uint8Array.from(labels), [...ZONE_L], out);
  return out;
}

/** What one LAB triple should come out as, straight from the converter. */
function expected(L: number, a: number, b: number): number[] {
  const out = new Uint8ClampedArray(4);
  labToSrgbPixel(L, a, b, out, 0);
  return Array.from(out);
}

describe('buildZoneColours', () => {
  it('produces one full-size buffer per zone', () => {
    const colours = buildZoneColours(new Float32Array(5), new Float32Array(5), [...ZONE_L]);
    expect(colours).toHaveLength(3);
    for (const buffer of colours) {
      expect(buffer.length).toBe(20);
    }
  });

  it('converts each pixel at its zone lightness with the source chroma', () => {
    const colours = buildZoneColours(
      Float32Array.from([20]),
      Float32Array.from([-30]),
      [...ZONE_L],
    );
    expect(Array.from(colours[1]!)).toEqual(expected(ZONE_L[1], 20, -30));
  });
});

describe('renderZones', () => {
  it('paints each label at its zone lightness, keeping the source chroma', () => {
    const out = tinted([ZONE_DARK, ZONE_MID, ZONE_LIGHT], [20, 20, 20], [-30, -30, -30]);
    expect(Array.from(out.slice(0, 4))).toEqual(expected(ZONE_L[0], 20, -30));
    expect(Array.from(out.slice(4, 8))).toEqual(expected(ZONE_L[1], 20, -30));
    expect(Array.from(out.slice(8, 12))).toEqual(expected(ZONE_L[2], 20, -30));
  });

  it('gives pixels in the same zone the same lightness but different colour', () => {
    const out = tinted([ZONE_MID, ZONE_MID], [40, -40], [40, -40]);
    expect(Array.from(out.slice(0, 3))).not.toEqual(Array.from(out.slice(4, 7)));
  });

  it('writes an opaque alpha for every pixel', () => {
    const out = tinted([ZONE_DARK, ZONE_MID], [5, 5], [5, 5]);
    expect(out[3]!).toBe(255);
    expect(out[7]!).toBe(255);
  });

  it('changes only the pixels whose zone changed', () => {
    // The property the precompute relies on: a pixel's colour is a function of its zone and its
    // own chroma, so re-rendering with a different label map cannot disturb its neighbours.
    const a = [10, 20, 30];
    const b = [-10, -20, -30];
    const before = tinted([ZONE_MID, ZONE_MID, ZONE_MID], a, b);
    const after = tinted([ZONE_MID, ZONE_LIGHT, ZONE_MID], a, b);
    expect(Array.from(after.slice(0, 4))).toEqual(Array.from(before.slice(0, 4)));
    expect(Array.from(after.slice(8, 12))).toEqual(Array.from(before.slice(8, 12)));
    expect(Array.from(after.slice(4, 8))).not.toEqual(Array.from(before.slice(4, 8)));
  });
});

describe('renderFlat', () => {
  it('produces neutral greys regardless of the source chroma', () => {
    const out = flat([ZONE_DARK, ZONE_MID, ZONE_LIGHT]);
    for (let i = 0; i < 3; i++) {
      expect(out[i * 4]!).toBe(out[i * 4 + 1]!);
      expect(out[i * 4 + 1]!).toBe(out[i * 4 + 2]!);
    }
  });

  it('orders the three steps from dark to light', () => {
    const out = flat([ZONE_DARK, ZONE_MID, ZONE_LIGHT]);
    expect(out[0]!).toBeLessThan(out[4]!);
    expect(out[4]!).toBeLessThan(out[8]!);
  });

  it('does not crush the extremes to pure black and white', () => {
    // SPEC.md §6.6: 0/128/255 crushes the ends and reads harder than any painting could be.
    const out = flat([ZONE_DARK, ZONE_LIGHT]);
    expect(out[0]!).toBeGreaterThan(0);
    expect(out[4]!).toBeLessThan(255);
  });

  it('matches the tinted render for a pixel that has no chroma', () => {
    const neutral = tinted([ZONE_MID], [0], [0]);
    expect(Array.from(flat([ZONE_MID]))).toEqual(Array.from(neutral));
  });

  it('writes an opaque alpha for every pixel', () => {
    const out = flat([ZONE_DARK, ZONE_MID]);
    expect(out[3]!).toBe(255);
    expect(out[7]!).toBe(255);
  });
});
