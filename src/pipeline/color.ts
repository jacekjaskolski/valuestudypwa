/**
 * sRGB ↔ CIELAB conversion (SPEC.md §6.1).
 *
 * All downstream work reads `L`; `a` and `b` are carried through untouched and used only at render
 * time. This replaces the prototype's RGB-average brightness, which is perceptually wrong and put
 * saturated colours in the wrong value zone.
 *
 * Pure: typed arrays in, typed arrays out. No DOM, no canvas, no globals.
 */

import type { Rgba } from './types';

export interface LabImage {
  /** Lightness, 0–100. */
  L: Float32Array;
  /** Green–red opponent axis, roughly −128..127, unbounded in principle. */
  a: Float32Array;
  /** Blue–yellow opponent axis, roughly −128..127, unbounded in principle. */
  b: Float32Array;
}

/** D65 white point, 2° observer, Y normalised to 1. */
const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;

/** The CIELAB f() curve switches from cube root to linear at t = (6/29)³. */
const DELTA = 6 / 29;
const DELTA_CUBED = DELTA * DELTA * DELTA;
const LINEAR_SLOPE = 3 * DELTA * DELTA;

/**
 * sRGB byte (0–255) → linear light (0–1). Precomputed: the transfer curve has a `pow` in it and
 * there are only 256 possible inputs.
 */
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function labF(t: number): number {
  return t > DELTA_CUBED ? Math.cbrt(t) : t / LINEAR_SLOPE + 4 / 29;
}

function labFInverse(t: number): number {
  return t > DELTA ? t * t * t : LINEAR_SLOPE * (t - 4 / 29);
}

/** Linear light (0–1) → sRGB byte (0–255), clamped into gamut. */
function linearToSrgbByte(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
}

/**
 * Convert an interleaved sRGB image to CIELAB channel arrays.
 *
 * Input: `rgba`, 4 bytes per pixel, sRGB, length `pixelCount * 4`. Alpha is ignored.
 * Output: three `Float32Array`s of length `pixelCount`; `L` in 0–100, `a`/`b` in CIELAB units.
 *
 * Runs once per image, in the expensive pass.
 */
export function srgbToLab(rgba: Rgba): LabImage {
  const pixelCount = rgba.length >> 2;
  const L = new Float32Array(pixelCount);
  const a = new Float32Array(pixelCount);
  const b = new Float32Array(pixelCount);

  for (let i = 0, p = 0; i < pixelCount; i++, p += 4) {
    const r = SRGB_TO_LINEAR[rgba[p]]!;
    const g = SRGB_TO_LINEAR[rgba[p + 1]]!;
    const bl = SRGB_TO_LINEAR[rgba[p + 2]]!;

    const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * bl) / XN;
    const y = (0.2126729 * r + 0.7151522 * g + 0.072175 * bl) / YN;
    const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * bl) / ZN;

    const fx = labF(x);
    const fy = labF(y);
    const fz = labF(z);

    L[i] = 116 * fy - 16;
    a[i] = 500 * (fx - fy);
    b[i] = 200 * (fy - fz);
  }

  return { L, a, b };
}

/**
 * Convert one CIELAB triple to sRGB bytes, written into `out` at byte `offset`. Alpha is set to
 * 255.
 *
 * Input: `L` 0–100, `a`/`b` in CIELAB units.
 * Output: three bytes plus alpha at `out[offset..offset+3]`, clamped into sRGB gamut.
 *
 * Scalar rather than whole-array because the render pass substitutes a zone's representative `L`
 * per pixel and would otherwise need a temporary `L` array every frame.
 */
export function labToSrgbPixel(
  L: number,
  a: number,
  b: number,
  out: Rgba,
  offset: number,
): void {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;

  const x = labFInverse(fx) * XN;
  const y = labFInverse(fy) * YN;
  const z = labFInverse(fz) * ZN;

  out[offset] = linearToSrgbByte(3.2404542 * x - 1.5371385 * y - 0.4985314 * z);
  out[offset + 1] = linearToSrgbByte(-0.969266 * x + 1.8760108 * y + 0.041556 * z);
  out[offset + 2] = linearToSrgbByte(0.0556434 * x - 0.2040259 * y + 1.0572252 * z);
  out[offset + 3] = 255;
}
