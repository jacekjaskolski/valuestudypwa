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
