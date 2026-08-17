/**
 * Wiring. The pipeline split from SPEC.md §4 is expressed here from the start: an expensive pass
 * that runs once per image, and a cheap pass that runs every frame while dragging. At §9 step 5
 * the expensive pass moves into a worker; keeping the seam visible now means that is a move
 * rather than a rewrite.
 */

import {
  DEFAULT_PERCENTILE_DARK,
  DEFAULT_PERCENTILE_LIGHT,
  HISTOGRAM_BINS,
  WORKING_RESOLUTION,
  ZONE_L,
} from './constants';
import { srgbToLab, type LabImage } from './pipeline/color';
import {
  buildHistogram,
  percentilesToCuts,
  suggestPercentiles,
} from './pipeline/histogram';
import {
  buildZoneColours,
  renderFlat,
  renderZones,
  type ZoneColours,
} from './pipeline/render';
import {
  clampBoundaries,
  thresholdL,
  type Boundaries,
  type ZoneMap,
} from './pipeline/threshold';
import type { Rgba } from './pipeline/types';
import {
  decodeToWorkingSize,
  drawHistogram,
  drawPixels,
  requireCanvas,
  requireElement,
  type SourcePixels,
} from './ui/canvas';
import { bindControls } from './ui/controls';

/**
 * Everything the expensive pass produces for one image, plus the buffers the cheap pass reuses so
 * that dragging allocates nothing. The depth map joins this at SPEC.md §9 step 6.
 */
interface ImageState {
  source: SourcePixels;
  lab: LabImage;
  /**
   * Histogram of `L`. Once aerial correction lands this becomes the histogram of *corrected* `L`
   * and moves into the cheap pass, because both the chart and the percentile boundaries have to
   * follow the correction (SPEC.md §7).
   */
  hist: Uint32Array;
  suggested: Boundaries;
  /** Every pixel's colour in every zone, so the cheap pass is a byte gather. */
  zoneColours: ZoneColours;
  labels: ZoneMap;
  output: Rgba;
}

interface Params {
  /** Percentiles of the image's own luminance, not positions on the `L` scale. */
  boundaries: Boundaries;
  greyscale: boolean;
}

const panels = requireElement('panels', HTMLElement);
const emptyState = requireElement('emptyState', HTMLParagraphElement);
const originalCanvas = requireCanvas('originalCanvas');
const studyCanvas = requireCanvas('studyCanvas');
const histogramCanvas = requireCanvas('histogram');

let state: ImageState | null = null;
let params: Params = {
  boundaries: { dark: DEFAULT_PERCENTILE_DARK, light: DEFAULT_PERCENTILE_LIGHT },
  greyscale: false,
};

/** Expensive pass: SPEC.md §4 steps 1–5. Runs once per image. */
async function runExpensivePass(file: Blob): Promise<ImageState> {
  const source = await decodeToWorkingSize(file, WORKING_RESOLUTION);
  const lab = srgbToLab(source.rgba);
  return {
    source,
    lab,
    hist: buildHistogram(lab.L, HISTOGRAM_BINS),
    suggested: suggestPercentiles(lab.L, source.width, source.height),
    zoneColours: buildZoneColours(lab.a, lab.b, ZONE_L),
    labels: new Uint8Array(source.width * source.height),
    output: new Uint8ClampedArray(source.rgba.length),
  };
}

/** Cheap pass: SPEC.md §4 steps 6–9. Runs on every control change. */
function runCheapPass(image: ImageState, current: Params): void {
  const started = performance.now();

  const cuts = percentilesToCuts(image.hist, current.boundaries);
  thresholdL(image.lab.L, cuts, image.labels);
  if (current.greyscale) {
    renderFlat(image.labels, ZONE_L, image.output);
  } else {
    renderZones(image.labels, image.zoneColours, image.output);
  }
  drawPixels(studyCanvas, image.output, image.source.width, image.source.height);
  drawHistogram(histogramCanvas, image.hist, [cuts.dark, cuts.light]);

  recordCheapPassTime(performance.now() - started);
}

/**
 * SPEC.md §11 wants the per-frame cost measured rather than assumed, and the answer recorded in
 * NOTES.md. Dev builds only.
 */
const cheapPassTimes: number[] = [];
function recordCheapPassTime(ms: number): void {
  if (!import.meta.env.DEV) {
    return;
  }
  cheapPassTimes.push(ms);
  if (cheapPassTimes.length === 30) {
    const sorted = [...cheapPassTimes].sort((x, y) => x - y);
    const median = sorted[sorted.length >> 1]!;
    const worst = sorted[sorted.length - 1]!;
    console.debug(
      `cheap pass over 30 frames: median ${median.toFixed(1)}ms, worst ${worst.toFixed(1)}ms ` +
        `at ${state?.source.width}x${state?.source.height}`,
    );
    cheapPassTimes.length = 0;
  }
}

let pendingFrame = 0;
function scheduleRender(): void {
  if (pendingFrame !== 0) {
    return;
  }
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = 0;
    if (state) {
      runCheapPass(state, params);
    }
  });
}

const controls = bindControls({
  onFile: (file) => void loadFile(file),
  onBoundaryMoved: (boundaries, moved) => {
    params = { ...params, boundaries: clampBoundaries(boundaries, moved) };
    controls.showBoundaries(params.boundaries);
    scheduleRender();
  },
  onGreyscale: (on) => {
    params = { ...params, greyscale: on };
    scheduleRender();
  },
  onReset: () => {
    if (!state) {
      return;
    }
    params = { ...params, boundaries: state.suggested };
    controls.showBoundaries(params.boundaries);
    scheduleRender();
  },
});

async function loadFile(file: Blob): Promise<void> {
  try {
    state = await runExpensivePass(file);
  } catch (error) {
    state = null;
    panels.hidden = true;
    controls.setStudyControlsVisible(false);
    emptyState.hidden = false;
    emptyState.textContent = 'That image could not be opened. Try another.';
    console.error(error);
    return;
  }

  const { rgba, width, height } = state.source;
  drawPixels(originalCanvas, rgba, width, height);
  panels.hidden = false;
  emptyState.hidden = true;
  controls.setStudyControlsVisible(true);

  // A photo opens on the suggestion, so the painter sees a usable study without touching a slider.
  params = { ...params, boundaries: state.suggested };
  controls.showBoundaries(params.boundaries);
  runCheapPass(state, params);
}

controls.showBoundaries(params.boundaries);

// The histogram is drawn at device pixel ratio against the canvas's CSS width, so a resize needs
// a redraw to stay crisp.
window.addEventListener('resize', scheduleRender);
