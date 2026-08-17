/**
 * Luminance histogram, percentile ↔ `L` conversion, and the default-threshold suggestion
 * (SPEC.md §6.4).
 *
 * The painter drags percentiles of the image's own luminance distribution rather than absolute
 * `L` values: percentiles behave the same across differently exposed photos, and make a default
 * suggestion meaningful. `percentilesToCuts` is the only place that conversion happens, so the
 * semantics can be swapped without hunting through the app.
 *
 * Pure: typed arrays in, typed arrays out.
 */

import {
  SUGGEST_DARK_SPREAD,
  SUGGEST_DARK_TARGET_FRACTION,
  SUGGEST_MID_OVERSHOOT,
  SUGGEST_MID_REGION_SOFTNESS,
  SUGGEST_MID_TARGET_FRACTION,
  SUGGEST_MIN_REGION_FRACTION,
  SUGGEST_PERCENTILE_STEP,
  SUGGEST_RESOLUTION,
  SUGGEST_SEPARATION_MIN,
  SUGGEST_WEIGHT_DARK,
  SUGGEST_WEIGHT_FRAGMENTATION,
  SUGGEST_WEIGHT_MID,
} from '../constants';
import { countRegionsAtLeast, labelRegions, largestArea } from './regions';
import { downsampleNearest, fitWithin } from './resize';
import { thresholdL, ZONE_DARK, ZONE_MID, type Boundaries } from './threshold';

/** The top of the `L` scale. Everything here works in 0–`L_MAX`. */
const L_MAX = 100;

/**
 * Count pixels into equal-width bins over `L` 0–100.
 *
 * Input: `L` 0–100; `bins` > 0. Output: counts per bin, summing to `L.length`.
 * Values outside the range are clamped into the end bins rather than dropped.
 */
export function buildHistogram(L: Float32Array, bins: number): Uint32Array {
  const hist = new Uint32Array(bins);
  const scale = bins / L_MAX;
  for (let i = 0; i < L.length; i++) {
    let bin = Math.floor(L[i]! * scale);
    if (bin < 0) {
      bin = 0;
    } else if (bin >= bins) {
      bin = bins - 1;
    }
    hist[bin]!++;
  }
  return hist;
}

function total(hist: Uint32Array): number {
  let sum = 0;
  for (let i = 0; i < hist.length; i++) {
    sum += hist[i]!;
  }
  return sum;
}

/**
 * The `L` value below which `percentile`% of the image's pixels fall.
 *
 * Input: `percentile` 0–100. Output: `L` 0–100, monotonically non-decreasing in `percentile`.
 * Interpolated within the containing bin, so dragging a slider does not step visibly.
 */
export function percentileToL(hist: Uint32Array, percentile: number): number {
  if (percentile <= 0) {
    return 0;
  }
  if (percentile >= 100) {
    return L_MAX;
  }

  const count = total(hist);
  if (count === 0) {
    return (percentile / 100) * L_MAX;
  }

  const target = (percentile / 100) * count;
  const binWidth = L_MAX / hist.length;
  let cumulative = 0;

  for (let i = 0; i < hist.length; i++) {
    const inBin = hist[i]!;
    if (cumulative + inBin >= target) {
      const within = inBin === 0 ? 0 : (target - cumulative) / inBin;
      return (i + within) * binWidth;
    }
    cumulative += inBin;
  }

  return L_MAX;
}

/**
 * The percentage of the image's pixels darker than `l`.
 *
 * Input: `l` 0–100. Output: percentile 0–100. The inverse of `percentileToL` up to bin
 * quantisation.
 */
export function lToPercentile(hist: Uint32Array, l: number): number {
  if (l <= 0) {
    return 0;
  }
  if (l >= L_MAX) {
    return 100;
  }

  const count = total(hist);
  if (count === 0) {
    return (l / L_MAX) * 100;
  }

  const binWidth = L_MAX / hist.length;
  const position = l / binWidth;
  const whole = Math.floor(position);
  let cumulative = 0;

  for (let i = 0; i < whole; i++) {
    cumulative += hist[i]!;
  }
  cumulative += (hist[whole] ?? 0) * (position - whole);

  return (cumulative / count) * 100;
}

/**
 * Turn the painter's two percentile boundaries into positions on the `L` scale.
 *
 * This is the single conversion point named in SPEC.md §6.4. Everything upstream of it speaks
 * percentiles; everything downstream speaks `L`.
 */
export function percentilesToCuts(
  hist: Uint32Array,
  percentiles: Boundaries,
): Boundaries {
  return {
    dark: percentileToL(hist, percentiles.dark),
    light: percentileToL(hist, percentiles.light),
  };
}

/**
 * Score one candidate pair of boundaries against the composition the brief asks for: a connected,
 * readable mid-value shape with minimal darks (SPEC.md §6.4).
 *
 * Input: `labels` for the candidate, at `width` × `height`. Output: a score; higher is better.
 * The three terms and their weights are all named constants — they are meant to be tuned by eye.
 */
export function scoreCandidate(
  labels: Uint8Array,
  width: number,
  height: number,
): number {
  const size = width * height;
  const minRegionArea = Math.max(1, size * SUGGEST_MIN_REGION_FRACTION);

  const mid = labelRegions(labels, width, height, ZONE_MID);
  const largestMidFraction = largestArea(mid) / size;
  const midRegions = countRegionsAtLeast(mid, minRegionArea);

  let darkPixels = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] === ZONE_DARK) {
      darkPixels++;
    }
  }
  const darkFraction = darkPixels / size;

  // Bigger mid shape is better, up to a point. Rises to a peak at the target, then falls away:
  // merely saturating is not enough, because then dissolving the whole picture into one mid mass
  // ties with a correctly separated study and wins on tie order.
  const midRatio = largestMidFraction / SUGGEST_MID_TARGET_FRACTION;
  const midScore =
    midRatio <= 1 ? midRatio : 1 / (1 + (midRatio - 1) * SUGGEST_MID_OVERSHOOT);

  // Fewer separate mid shapes is better. Speckle below the minimum area is ignored — shape
  // simplification removes it anyway.
  const fragmentationScore = 1 / (1 + midRegions / SUGGEST_MID_REGION_SOFTNESS);

  // Darks should be small but present. A study with no darks has nothing to read against.
  const darkOffset = (darkFraction - SUGGEST_DARK_TARGET_FRACTION) / SUGGEST_DARK_SPREAD;
  const darkScore = Math.exp(-darkOffset * darkOffset);

  return (
    SUGGEST_WEIGHT_MID * midScore +
    SUGGEST_WEIGHT_FRAGMENTATION * fragmentationScore +
    SUGGEST_WEIGHT_DARK * darkScore
  );
}

/**
 * Search for the pair of percentile boundaries that best fits the target composition.
 *
 * Input: `L` 0–100 at `width` × `height`. Output: the two boundaries as percentiles 0–100.
 *
 * The search runs on a downsampled copy: it evaluates dozens of candidates, each of which does a
 * connected-component pass, and percentiles are resolution-independent so the answer transfers
 * back to the full image unchanged.
 */
export function suggestPercentiles(
  L: Float32Array,
  width: number,
  height: number,
): Boundaries {
  const target = fitWithin(width, height, SUGGEST_RESOLUTION);
  const small = downsampleNearest(L, width, height, target);
  const hist = buildHistogram(small, 256);
  const labels = new Uint8Array(small.length);

  let best: Boundaries = { dark: 25, light: 75 };
  let bestScore = -Infinity;

  for (let dark = 0; dark <= 100 - SUGGEST_SEPARATION_MIN; dark += SUGGEST_PERCENTILE_STEP) {
    for (
      let light = dark + SUGGEST_SEPARATION_MIN;
      light <= 100;
      light += SUGGEST_PERCENTILE_STEP
    ) {
      const candidate = { dark, light };
      thresholdL(small, percentilesToCuts(hist, candidate), labels);
      const score = scoreCandidate(labels, target.width, target.height);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
  }

  return best;
}
