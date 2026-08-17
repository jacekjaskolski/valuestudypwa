/**
 * Working-resolution sizing (SPEC.md §6.1). Pure arithmetic — no canvas, no DOM.
 */

export interface Size {
  width: number;
  height: number;
}

/**
 * Fit a size inside a maximum longest edge, preserving aspect ratio.
 *
 * Input: `width`, `height` in pixels (> 0); `maxEdge` in pixels (> 0).
 * Output: integer pixel size whose longest edge is at most `maxEdge`.
 *
 * Never upscales: a size already within `maxEdge` is returned unchanged. The reference prototype
 * did upscale small images (`ref/image_upload.js` `resizeDimensions`), which invents detail and
 * costs work for nothing.
 */
export function fitWithin(width: number, height: number, maxEdge: number): Size {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) {
    return { width, height };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Nearest-neighbour downsample of a single channel.
 *
 * Input: `src` in row-major order at `width` × `height`; `target`, a size no larger than the
 * source. Output: a new array of `target.width * target.height` values.
 *
 * Nearest rather than area-averaged on purpose: this feeds the default-threshold search, which
 * asks how the image's values clump together. Averaging would smooth away exactly the speckle the
 * scorer is trying to notice.
 */
export function downsampleNearest(
  src: Float32Array,
  width: number,
  height: number,
  target: Size,
): Float32Array {
  const out = new Float32Array(target.width * target.height);
  const xScale = width / target.width;
  const yScale = height / target.height;

  for (let y = 0; y < target.height; y++) {
    const sourceRow = Math.min(height - 1, Math.floor(y * yScale)) * width;
    const outRow = y * target.width;
    for (let x = 0; x < target.width; x++) {
      out[outRow + x] = src[sourceRow + Math.min(width - 1, Math.floor(x * xScale))]!;
    }
  }

  return out;
}
