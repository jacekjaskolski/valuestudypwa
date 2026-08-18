/**
 * Edge-clamped Gaussian blur, for the squint preview.
 *
 * Done here rather than as a CSS or SVG filter because of the borders. A filter blurs the photo
 * against the transparency outside it, so the edge either fades out or, if you paste the sharp
 * original back underneath to stop that, keeps a ring of unblurred pixels around the frame. Both
 * are artifacts at exactly the place a painter is checking the composition against.
 *
 * Sampling past an edge here returns the edge pixel instead, which is the same thing as extending
 * the photo outwards before blurring, without the extending. The output is the same size as the
 * input, so the crop is exact by construction rather than applied afterwards.
 *
 * Three box passes approximate a Gaussian closely enough that the difference is invisible at these
 * radii, and a box pass with a running sum costs the same whatever the radius — which matters,
 * because the far end of the Squint slider is a very large radius.
 *
 * Pure: typed arrays in, typed arrays out.
 */

import { SQUINT_BLUR_DETAIL, SQUINT_MAX_REDUCTION } from '../constants';
import type { Rgba } from './types';

/**
 * A buffer a pass may write into. The intermediates are plain `Uint8Array`: every value is an
 * average of bytes and so already in range, and skipping `Uint8ClampedArray`'s rounding and
 * clamping on each of the millions of writes is worth measurable time.
 */
type Bytes = Uint8Array<ArrayBuffer> | Rgba;

/** Below this sigma a blur is not visible, and the passes are skipped. */
const MIN_SIGMA = 0.5;

/** How many box passes approximate the Gaussian. Three is the usual point of diminishing return. */
const PASSES = 3;

/**
 * Box radii whose successive application approximates a Gaussian of standard deviation `sigma`.
 *
 * Input: `sigma` in pixels; `passes` > 0. Output: one radius per pass, in pixels.
 *
 * Follows Kovesi's construction: pick the odd box width bracketing the ideal, then split the
 * passes between the two widths so the total variance lands on target.
 */
export function boxRadii(sigma: number, passes: number): number[] {
  const idealWidth = Math.sqrt((12 * sigma * sigma) / passes + 1);
  let lower = Math.floor(idealWidth);
  if (lower % 2 === 0) {
    lower--;
  }
  const upper = lower + 2;

  const crossover = Math.round(
    (12 * sigma * sigma - passes * lower * lower - 4 * passes * lower - 3 * passes) /
      (-4 * lower - 4),
  );

  const radii: number[] = [];
  for (let i = 0; i < passes; i++) {
    const width = i < crossover ? lower : upper;
    radii.push(Math.max(0, (width - 1) / 2));
  }
  return radii;
}

/**
 * Buffers the passes ping-pong through, allocated once per image.
 *
 * Sized for the full image, since a reduction of one is possible; the reduced passes just use the
 * front of each.
 */
export interface BlurScratch {
  a: Uint8Array<ArrayBuffer>;
  b: Uint8Array<ArrayBuffer>;
  reduced: Rgba;
  blurred: Rgba;
  highlights: Rgba;
}

export function createBlurScratch(byteLength: number): BlurScratch {
  return {
    a: new Uint8Array(byteLength),
    b: new Uint8Array(byteLength),
    reduced: new Uint8ClampedArray(byteLength),
    blurred: new Uint8ClampedArray(byteLength),
    highlights: new Uint8ClampedArray(byteLength),
  };
}

/**
 * How much to shrink the image before blurring it, given the blur.
 *
 * A blur of standard deviation `sigma` destroys everything finer than about `sigma`, so computing
 * it at full resolution is work whose result is thrown away. Shrinking first and letting the
 * canvas scale the answer back up costs a fraction as much and is indistinguishable — as long as
 * the blur still spans a few pixels at the reduced size, which `SQUINT_BLUR_DETAIL` is what sets.
 *
 * Output: an integer factor of 1 or more; 1 means blur at full resolution.
 */
export function blurReduction(sigma: number): number {
  const factor = Math.floor(sigma / SQUINT_BLUR_DETAIL);
  return factor < 1 ? 1 : factor > SQUINT_MAX_REDUCTION ? SQUINT_MAX_REDUCTION : factor;
}

/**
 * Shrink by an integer factor, averaging each block.
 *
 * Input: `src` at `width` × `height`; `factor` >= 1. Output: `dst`, at the ceiling of each
 * dimension over the factor.
 *
 * The last block in a row or column runs past the edge when the factor does not divide the size.
 * It is filled by repeating the edge pixel, the same way the blur samples past an edge, so every
 * block averages the same number of samples. Averaging the remainder alone instead gives the edge
 * block a different weight from all the others, and since the size of that remainder changes with
 * the factor, the border shifts as the slider moves it.
 */
export function downsampleBox(
  src: Rgba,
  width: number,
  height: number,
  factor: number,
  dst: Rgba,
): { width: number; height: number } {
  const outWidth = Math.ceil(width / factor);
  const outHeight = Math.ceil(height / factor);

  const count = factor * factor;

  for (let dy = 0; dy < outHeight; dy++) {
    for (let dx = 0; dx < outWidth; dx++) {
      let r = 0;
      let g = 0;
      let b = 0;

      for (let k = 0; k < factor; k++) {
        const y = dy * factor + k;
        const row = (y >= height ? height - 1 : y) * width * 4;
        for (let j = 0; j < factor; j++) {
          const x = dx * factor + j;
          const p = row + (x >= width ? width - 1 : x) * 4;
          r += src[p]!;
          g += src[p + 1]!;
          b += src[p + 2]!;
        }
      }

      const p = (dy * outWidth + dx) * 4;
      dst[p] = r / count + 0.5;
      dst[p + 1] = g / count + 0.5;
      dst[p + 2] = b / count + 0.5;
      dst[p + 3] = 255;
    }
  }

  return { width: outWidth, height: outHeight };
}

/**
 * One horizontal box pass. Samples past either end return the end pixel.
 *
 * The window is always `2 * radius + 1` wide, because clamping supplies a pixel for every
 * position — so the running sum needs no special case, and the divisor never changes.
 */
function boxHorizontal(
  src: Bytes,
  dst: Bytes,
  width: number,
  height: number,
  radius: number,
): void {
  if (radius < 1) {
    dst.set(src);
    return;
  }
  const scale = 1 / (radius * 2 + 1);

  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    let r = 0;
    let g = 0;
    let b = 0;

    for (let k = -radius; k <= radius; k++) {
      const p = row + (k < 0 ? 0 : k >= width ? width - 1 : k) * 4;
      r += src[p]!;
      g += src[p + 1]!;
      b += src[p + 2]!;
    }

    for (let x = 0; x < width; x++) {
      const p = row + x * 4;
      dst[p] = r * scale + 0.5;
      dst[p + 1] = g * scale + 0.5;
      dst[p + 2] = b * scale + 0.5;
      dst[p + 3] = 255;

      const leaving = row + (x - radius < 0 ? 0 : x - radius) * 4;
      const entering =
        row + (x + radius + 1 >= width ? width - 1 : x + radius + 1) * 4;
      r += src[entering]! - src[leaving]!;
      g += src[entering + 1]! - src[leaving + 1]!;
      b += src[entering + 2]! - src[leaving + 2]!;
    }
  }
}

/** One vertical box pass, clamped the same way. */
function boxVertical(
  src: Bytes,
  dst: Bytes,
  width: number,
  height: number,
  radius: number,
): void {
  if (radius < 1) {
    dst.set(src);
    return;
  }
  const scale = 1 / (radius * 2 + 1);
  const stride = width * 4;

  for (let x = 0; x < width; x++) {
    const column = x * 4;
    let r = 0;
    let g = 0;
    let b = 0;

    for (let k = -radius; k <= radius; k++) {
      const p = column + (k < 0 ? 0 : k >= height ? height - 1 : k) * stride;
      r += src[p]!;
      g += src[p + 1]!;
      b += src[p + 2]!;
    }

    for (let y = 0; y < height; y++) {
      const p = column + y * stride;
      dst[p] = r * scale + 0.5;
      dst[p + 1] = g * scale + 0.5;
      dst[p + 2] = b * scale + 0.5;
      dst[p + 3] = 255;

      const leaving = column + (y - radius < 0 ? 0 : y - radius) * stride;
      const entering =
        column + (y + radius + 1 >= height ? height - 1 : y + radius + 1) * stride;
      r += src[entering]! - src[leaving]!;
      g += src[entering + 1]! - src[leaving + 1]!;
      b += src[entering + 2]! - src[leaving + 2]!;
    }
  }
}

/**
 * Blur an image, clamping at its edges.
 *
 * Input: `src`, interleaved RGBA at `width` × `height`; `sigma` in pixels.
 * Output: `out`, the same size, written in place. Alpha is set opaque.
 *
 * `src` is not modified, so the caller can keep the sharp original.
 */
export function blurRgba(
  src: Rgba,
  width: number,
  height: number,
  sigma: number,
  scratch: BlurScratch,
  out: Rgba,
): Rgba {
  if (sigma < MIN_SIGMA) {
    out.set(src);
    return out;
  }

  const radii = boxRadii(sigma, PASSES);
  const { a, b } = scratch;

  // Ping-pong so that nothing writes into `src`, and the last vertical pass lands in `out`.
  boxHorizontal(src, a, width, height, radii[0]!);
  boxVertical(a, b, width, height, radii[0]!);
  boxHorizontal(b, a, width, height, radii[1]!);
  boxVertical(a, b, width, height, radii[1]!);
  boxHorizontal(b, a, width, height, radii[2]!);
  boxVertical(a, out, width, height, radii[2]!);

  return out;
}

/**
 * Keep whichever of two images is lighter at each pixel.
 *
 * Input: two interleaved RGBA buffers. Output: `out`, written in place; may alias either input.
 * Only the first `length` bytes are touched, so a reduced image can share a full-size buffer.
 */
export function lightenInto(first: Rgba, second: Rgba, length: number, out: Rgba): Rgba {
  for (let p = 0; p < length; p += 4) {
    const r = first[p]!;
    const g = first[p + 1]!;
    const b = first[p + 2]!;
    const r2 = second[p]!;
    const g2 = second[p + 1]!;
    const b2 = second[p + 2]!;
    out[p] = r > r2 ? r : r2;
    out[p + 1] = g > g2 ? g : g2;
    out[p + 2] = b > b2 ? b : b2;
    out[p + 3] = 255;
  }
  return out;
}

/** A blurred image, possibly smaller than the one it came from. */
export interface BlurResult {
  pixels: Rgba;
  width: number;
  height: number;
  /**
   * How much it was shrunk. The caller must scale by exactly this to draw it, *not* by whatever
   * ratio maps its size back onto the original: the reduced image covers `width * factor` source
   * pixels, which rounds up past the original width whenever the two do not divide evenly.
   */
  factor: number;
}

/**
 * The squint preview: blur the photo, optionally keeping its highlights.
 *
 * Input: `src` at `width` × `height`; `sigma` in pixels of the source.
 * Output: the blurred image, which may be smaller than the input — the caller scales it back up
 * when drawing, which the canvas does on the GPU for nothing.
 *
 * With `keepHighlights`, the photo is blurred twice and the lighter of each pair is kept, so
 * bright accents stay roughly where they are while everything darker melts together.
 */
export function squintBlur(
  src: Rgba,
  width: number,
  height: number,
  sigma: number,
  keepHighlights: boolean,
  highlightRatio: number,
  scratch: BlurScratch,
): BlurResult {
  const factor = blurReduction(sigma);

  let source = src;
  let workWidth = width;
  let workHeight = height;
  if (factor > 1) {
    const size = downsampleBox(src, width, height, factor, scratch.reduced);
    source = scratch.reduced;
    workWidth = size.width;
    workHeight = size.height;
  }

  const workSigma = sigma / factor;
  blurRgba(source, workWidth, workHeight, workSigma, scratch, scratch.blurred);

  if (!keepHighlights) {
    return { pixels: scratch.blurred, width: workWidth, height: workHeight, factor };
  }

  blurRgba(source, workWidth, workHeight, workSigma * highlightRatio, scratch, scratch.highlights);
  lightenInto(
    scratch.highlights,
    scratch.blurred,
    workWidth * workHeight * 4,
    scratch.highlights,
  );
  return { pixels: scratch.highlights, width: workWidth, height: workHeight, factor };
}
