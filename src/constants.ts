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

/**
 * Number of bins in the luminance histogram.
 *
 * More bins: finer slider steps and a spikier chart. Fewer: a smoother chart and visible stepping
 * as a boundary is dragged.
 */
export const HISTOGRAM_BINS = 256;

/**
 * Starting boundaries as percentiles of the image's own luminance, used before an image is loaded
 * and as the fallback if the search finds nothing.
 */
export const DEFAULT_PERCENTILE_DARK = 25;
export const DEFAULT_PERCENTILE_LIGHT = 75;

/* --- default threshold suggestion (SPEC.md §6.4) -------------------------
 * These are a heuristic and are meant to be tuned by eye. Record what a change did in NOTES.md.
 */

/**
 * Longest edge the candidate search runs at. The search evaluates dozens of candidates, each with
 * a connected-component pass, so it does not run at working resolution.
 *
 * Larger: the scorer sees finer shape structure, and opening a photo takes longer.
 */
export const SUGGEST_RESOLUTION = 256;

/** Percentile step between candidates. Smaller: a finer search, quadratically more work. */
export const SUGGEST_PERCENTILE_STEP = 5;

/** Minimum percentile gap between the two boundaries, so a candidate always has a mid zone. */
export const SUGGEST_SEPARATION_MIN = 10;

/**
 * The largest mid-value shape stops earning credit once it covers this fraction of the image.
 *
 * Higher: pushes towards one big mid mass, flattening the study. Lower: the scorer stops caring
 * about mid connectedness early and the other two terms decide.
 */
export const SUGGEST_MID_TARGET_FRACTION = 0.45;

/**
 * How hard a mid shape *larger* than the target is penalised.
 *
 * Without a penalty the term merely saturates, and the search happily swallows the whole picture
 * into one mid mass — that scores as well as a correctly separated study and wins on tie order.
 * Higher: mid area is held tightly to the target. Lower: sprawling mid shapes are tolerated.
 */
export const SUGGEST_MID_OVERSHOOT = 1;

/**
 * How gently the fragmentation penalty grows: the score is halved at this many mid regions.
 *
 * Higher: tolerates busier, more scattered mid shapes. Lower: strongly prefers one big shape.
 */
export const SUGGEST_MID_REGION_SOFTNESS = 8;

/**
 * Regions below this fraction of the image are speckle and are not counted as separate shapes.
 * Shape simplification removes them anyway.
 */
export const SUGGEST_MIN_REGION_FRACTION = 0.002;

/**
 * The dark area the suggestion aims for, as a fraction of the image. Small but never zero — a
 * study with no darks has nothing to read against.
 */
export const SUGGEST_DARK_TARGET_FRACTION = 0.12;

/** How far the dark area may drift from the target before the term stops contributing. */
export const SUGGEST_DARK_SPREAD = 0.1;

/** Relative pull of each scoring term. Raise one to let it decide more of the outcome. */
export const SUGGEST_WEIGHT_MID = 1;
export const SUGGEST_WEIGHT_FRAGMENTATION = 0.6;
export const SUGGEST_WEIGHT_DARK = 0.8;
