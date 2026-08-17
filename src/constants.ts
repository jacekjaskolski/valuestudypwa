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

/**
 * The lightness (CIELAB `L`, 0–100) each zone is painted at, indexed dark / mid / light.
 *
 * Not 0 / 50 / 100: pure black and white crush the extremes and make the study read harder than
 * any painting could be. Spreading them wider raises contrast between the three steps; pulling
 * them together makes the study flatter and closer to the photo's own range.
 */
export const ZONE_L: readonly number[] = [12, 50, 88];

/** Starting boundaries on the `L` scale, used until the histogram suggests better ones. */
export const DEFAULT_CUT_DARK = 33;
export const DEFAULT_CUT_LIGHT = 66;
