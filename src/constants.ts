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
 * The light zone is pure white because in watercolour it is not paint at all — it is the paper,
 * left alone. SPEC.md §6.6 argued for near-white on the grounds that pure values crush the
 * extremes; that reasoning holds for the dark end, which stays short of black because no wash
 * reaches it, but not for the light end.
 *
 * Spreading the three wider raises contrast between the steps; pulling them together makes the
 * study flatter and closer to the photo's own range.
 */
export const ZONE_L: readonly number[] = [12, 50, 100];

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

/* --- shape simplification (SPEC.md §6.5) ---------------------------------
 * One Simplify slider drives both stages; these set what its far end means.
 */

/**
 * At full strength, the majority window's radius as a fraction of the image's longest edge.
 *
 * Higher: shapes merge into broad masses and fine structure disappears entirely.
 * Lower: the slider tops out before it can unify anything larger than speckle.
 */
export const SIMPLIFY_MAX_RADIUS_FRACTION = 0.008;

/**
 * At full strength, the smallest region kept, as a fraction of total image area.
 *
 * Higher: isolated shapes get swallowed by whatever surrounds them, including ones the painter
 * may have wanted. Lower: scattered islands survive and the study stays busy.
 */
export const SIMPLIFY_MAX_AREA_FRACTION = 0.01;

/**
 * At full strength, the squint blur as a fraction of the displayed photo's width.
 *
 * This is a display effect on the reference photo, not a pipeline stage: squinting is how a
 * painter finds unified shapes, and a blur is the honest simulation of it.
 * Higher: only the largest masses survive. Lower: the slider never merges anything.
 */
export const SQUINT_MAX_BLUR_FRACTION = 0.025;

/**
 * With "keep highlights" on, how much of the main blur the highlight layer gets.
 *
 * Squinting does not smear a bright accent the way a plain blur does — it stays bright and stays
 * roughly where it is, while everything darker melts together. So the photo is blurred twice and
 * the two are combined by taking the lighter of each pair.
 *
 * Higher: highlights soften along with everything else and the toggle stops mattering.
 * Lower: bright accents stay hard-edged and the picture looks masked rather than squinted.
 */
export const SQUINT_HIGHLIGHT_BLUR_RATIO = 0.3;

/**
 * How many pixels the blur must still span after the image is shrunk to compute it.
 *
 * A blur destroys everything finer than its own radius, so it is computed at reduced resolution
 * and scaled back up. Higher: less shrinking, so more work and a slower Squint slider. Lower: more
 * shrinking, until the reduced image is too coarse for the blur and the upscale shows as blocking.
 */
export const SQUINT_BLUR_DETAIL = 1;

/** The most the image may be shrunk before blurring, whatever the radius. */
export const SQUINT_MAX_REDUCTION = 8;

/* --- depth estimation (SPEC.md §6.2) --------------------------------------
 * Depth is an enhancement, not a dependency: if any of this fails the app carries on with the
 * correction switched off.
 */

/**
 * The depth model. **Small only** — it is Apache 2.0, while the base and large variants are
 * cc-by-nc-4.0 and cannot be used here (SPEC.md §3).
 */
export const DEPTH_MODEL = 'onnx-community/depth-anything-v2-small';

/**
 * Weight precision, per backend. The full-precision file is 99MB, which is far past what an iOS
 * PWA should be asked to cache; these are the quantised ones.
 *
 * `q8` is 27MB and runs anywhere. `q4f16` is 19MB but needs the half-precision support that comes
 * with WebGPU. Raising precision costs download size and memory; lowering it costs detail in the
 * depth map, which shows up as blocky or hesitant boundaries between planes.
 */
export const DEPTH_DTYPE_WASM = 'q8';
export const DEPTH_DTYPE_WEBGPU = 'q4f16';

/**
 * Whether the model's own numbers run high for *near*.
 *
 * Depth Anything outputs inverse depth, so this should be true — but SPEC.md §6.2 asks for it to
 * be verified against a real image rather than assumed, which is what the Depth view is for. If
 * distance comes out black instead of white, this is the one thing to flip.
 */
export const DEPTH_NEAR_IS_HIGH = true;

/* --- aerial perspective (SPEC.md §6.3) ------------------------------------- */

/**
 * The lightness the correction pulls distance towards.
 *
 * At 100 the farthest planes go all the way to paper white at full strength. Lower it to hold
 * something back at the horizon, so distance never quite disappears.
 */
export const AERIAL_L_CEILING = 100;

/** The pale blue that distance is mixed towards in the photo preview: sRGB, 0–255. */
export const HAZE_COLOUR: readonly [number, number, number] = [196, 214, 234];

/**
 * How much colour distance loses before it is mixed towards the haze, 0–1 at full effect.
 *
 * Higher: distance goes grey first, so the haze reads as air. Lower: original hues survive into
 * the mix and warm colours turn purple on their way to blue.
 */
export const HAZE_DESATURATION = 0.7;

/** Where the effect starts and how strong it is, before the painter touches either slider. */
export const AERIAL_DEFAULT_START = 0.35;
export const AERIAL_DEFAULT_STRENGTH = 0.5;

/**
 * Where the sharp band sits by default, on the 0–1 depth scale. Near, since a subject usually is.
 */
export const FOCUS_DEFAULT_DEPTH = 0.25;

/**
 * How quickly detail is given up either side of the focus depth — the standard deviation of the
 * falloff, in depth units.
 *
 * Higher: a deep band, most of the scene keeps its detail and the effect stops being selective.
 * Lower: a narrow slice in focus and everything else simplified, which on a shallow depth map can
 * leave nothing sharp at all.
 */
export const FOCUS_FALLOFF = 0.18;

/**
 * How much of the falloff counts as in focus, 0–1.
 *
 * A zone label is discrete — a pixel keeps its detail or it does not — so the Gaussian has to be
 * decided somewhere. At 0.5 the sharp band runs about 1.2 standard deviations either side of the
 * focus depth, giving it a near and a far limit like a real depth of field.
 *
 * Raising it narrows the band; lowering it widens it. It does not soften the transition: for that
 * the simplification would have to run at several strengths, one pass each.
 */
export const FOCUS_WEIGHT_THRESHOLD = 0.5;
