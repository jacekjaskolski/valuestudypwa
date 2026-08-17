import { describe, expect, it } from 'vitest';
import { clampBoundaries, thresholdL, ZONE_DARK, ZONE_LIGHT, ZONE_MID } from './threshold';

describe('clampBoundaries', () => {
  it('leaves an ordered pair alone', () => {
    expect(clampBoundaries({ dark: 30, light: 70 }, 'dark')).toEqual({ dark: 30, light: 70 });
  });

  it('clamps the dark boundary when it is dragged past the light one', () => {
    expect(clampBoundaries({ dark: 80, light: 70 }, 'dark')).toEqual({ dark: 70, light: 70 });
  });

  it('clamps the light boundary when it is dragged past the dark one', () => {
    expect(clampBoundaries({ dark: 40, light: 20 }, 'light')).toEqual({ dark: 40, light: 40 });
  });

  it('never moves the boundary the painter is not touching', () => {
    expect(clampBoundaries({ dark: 80, light: 70 }, 'dark').light).toBe(70);
    expect(clampBoundaries({ dark: 40, light: 20 }, 'light').dark).toBe(40);
  });

  it('allows the two to meet, collapsing the mid zone', () => {
    expect(clampBoundaries({ dark: 50, light: 50 }, 'dark')).toEqual({ dark: 50, light: 50 });
  });
});

describe('thresholdL', () => {
  const ramp = Float32Array.from([0, 25, 32.9, 33, 50, 65.9, 66, 80, 100]);

  it('splits a ramp into three zones at the boundaries', () => {
    const out = thresholdL(ramp, { dark: 33, light: 66 }, new Uint8Array(ramp.length));
    expect(Array.from(out)).toEqual([
      ZONE_DARK,
      ZONE_DARK,
      ZONE_DARK,
      ZONE_MID, // L === dark boundary lands in mid
      ZONE_MID,
      ZONE_MID,
      ZONE_LIGHT, // L === light boundary lands in light
      ZONE_LIGHT,
      ZONE_LIGHT,
    ]);
  });

  it('produces no mid pixels when the boundaries meet', () => {
    const out = thresholdL(ramp, { dark: 50, light: 50 }, new Uint8Array(ramp.length));
    expect(Array.from(out)).not.toContain(ZONE_MID);
  });

  it('makes everything light when both boundaries sit at zero', () => {
    const out = thresholdL(ramp, { dark: 0, light: 0 }, new Uint8Array(ramp.length));
    expect(Array.from(out).every((z) => z === ZONE_LIGHT)).toBe(true);
  });

  it('makes everything dark when both boundaries sit above the range', () => {
    const out = thresholdL(ramp, { dark: 101, light: 101 }, new Uint8Array(ramp.length));
    expect(Array.from(out).every((z) => z === ZONE_DARK)).toBe(true);
  });

  it('writes into the buffer it was given and returns it', () => {
    const out = new Uint8Array(ramp.length);
    expect(thresholdL(ramp, { dark: 33, light: 66 }, out)).toBe(out);
  });
});
