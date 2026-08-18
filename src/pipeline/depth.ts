/**
 * Depth map handling (SPEC.md §6.2) — the parts that are arithmetic.
 *
 * Loading and running the model lives in `src/model/depth.ts`, not here: it needs the network and
 * a WASM or WebGPU backend, which the purity rule keeps out of `src/pipeline/`. It also keeps the
 * node-only half of transformers.js out of the test run.
 *
 * Pure: typed arrays in, typed arrays out.
 */

/**
 * Normalise a raw depth map to 0–1, where **1 is farthest**.
 *
 * Input: `raw`, whatever scale the model produced. Output: `out`, same length, 0–1.
 *
 * `nearIsHigh` says which way the model's own numbers run, and is not a guess: SPEC.md §6.2 asks
 * for it to be verified against a real image before the correction is written. Depth Anything
 * outputs inverse depth, so higher means nearer — but that is the thing to confirm by eye, which
 * is what the Depth view is for.
 *
 * A flat map (every value identical) normalises to all-zero, meaning "all near", so a model that
 * fails to find any structure leaves the correction doing nothing rather than something wrong.
 */
export function normalizeDepth(
  raw: Float32Array,
  nearIsHigh: boolean,
  out: Float32Array,
): Float32Array {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < raw.length; i++) {
    const value = raw[i]!;
    if (value < min) {
      min = value;
    }
    if (value > max) {
      max = value;
    }
  }

  const span = max - min;
  if (span <= 0) {
    out.fill(0);
    return out;
  }

  const scale = 1 / span;
  for (let i = 0; i < raw.length; i++) {
    const unit = (raw[i]! - min) * scale;
    out[i] = nearIsHigh ? 1 - unit : unit;
  }
  return out;
}

/**
 * Bilinear resample of a single channel.
 *
 * Input: `src` at `srcWidth` × `srcHeight`. Output: `dst` at `dstWidth` × `dstHeight`.
 *
 * The model runs at its own input size, so its output has to be stretched back to the working
 * resolution (SPEC.md §6.2). Sample positions are taken from pixel centres and clamped at the
 * edges, so the result lines up with the image rather than drifting half a pixel across it.
 */
export function resampleBilinear(
  src: Float32Array,
  srcWidth: number,
  srcHeight: number,
  dst: Float32Array,
  dstWidth: number,
  dstHeight: number,
): Float32Array {
  const xRatio = srcWidth / dstWidth;
  const yRatio = srcHeight / dstHeight;

  for (let y = 0; y < dstHeight; y++) {
    const sourceY = (y + 0.5) * yRatio - 0.5;
    const y0 = Math.floor(sourceY);
    const ty = sourceY - y0;
    const row0 = Math.min(srcHeight - 1, Math.max(0, y0)) * srcWidth;
    const row1 = Math.min(srcHeight - 1, Math.max(0, y0 + 1)) * srcWidth;

    for (let x = 0; x < dstWidth; x++) {
      const sourceX = (x + 0.5) * xRatio - 0.5;
      const x0 = Math.floor(sourceX);
      const tx = sourceX - x0;
      const col0 = Math.min(srcWidth - 1, Math.max(0, x0));
      const col1 = Math.min(srcWidth - 1, Math.max(0, x0 + 1));

      const top = src[row0 + col0]! + (src[row0 + col1]! - src[row0 + col0]!) * tx;
      const bottom = src[row1 + col0]! + (src[row1 + col1]! - src[row1 + col0]!) * tx;
      dst[y * dstWidth + x] = top + (bottom - top) * ty;
    }
  }

  return dst;
}

/**
 * Paint a depth map as greyscale RGBA, for looking at it.
 *
 * Input: `depth` 0–1. Output: `out`, interleaved RGBA. Far reads as white, which is the same
 * direction the value study paints distance, so the two can be compared by eye.
 */
export function renderDepth(
  depth: Float32Array,
  out: Uint8ClampedArray<ArrayBuffer>,
): Uint8ClampedArray<ArrayBuffer> {
  for (let i = 0, p = 0; i < depth.length; i++, p += 4) {
    const value = depth[i]! * 255;
    out[p] = value;
    out[p + 1] = value;
    out[p + 2] = value;
    out[p + 3] = 255;
  }
  return out;
}
