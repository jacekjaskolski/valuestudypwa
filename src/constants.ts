/**
 * Every constant that gets tuned by eye lives here, with a comment saying what changing it does
 * visually (SPEC.md §12). Nothing in here is a magic number found at a call site.
 */

/**
 * Longest edge, in pixels, that the pipeline works at. The image is downscaled to this before any
 * processing; smaller images are never upscaled.
 *
 * Larger: finer detail survives into the value map, and the per-frame pass gets slower.
 * Smaller: dragging stays smooth, shapes come out chunkier.
 */
export const WORKING_RESOLUTION = 1024;
