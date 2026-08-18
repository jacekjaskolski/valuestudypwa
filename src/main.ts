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
  SETTLE_DELAY_MS,
  SQUINT_MAX_BLUR_FRACTION,
  WORKING_RESOLUTION,
  ZONE_L,
} from './constants';
import { srgbToLab, type LabImage } from './pipeline/color';
import {
  buildHistogram,
  lToPercentile,
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
  absorbSmallRegions,
  createSimplifyScratch,
  majorityFilter,
  simplifySettings,
  type SimplifyScratch,
} from './pipeline/simplify';
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
import { bindControls, type View } from './ui/controls';
import { bindValueBar } from './ui/valuebar';

/**
 * Everything the expensive pass produces for one image, plus the buffers the cheap pass reuses so
 * that dragging allocates nothing. The depth map joins this at SPEC.md §9 step 6.
 */
interface ImageState {
  source: SourcePixels;
  lab: LabImage;
  /**
   * Histogram of `L`. Once aerial correction lands this becomes the histogram of *corrected* `L`
   * and moves into the cheap pass, because both the chart and the boundary readouts have to
   * follow the correction (SPEC.md §7).
   */
  hist: Uint32Array;
  /** The opening boundaries, in `L`, converted from the suggestion when the photo loaded. */
  suggested: Boundaries;
  /**
   * Every pixel's colour in every zone, so the cheap pass is a byte gather. Built on demand: the
   * study opens in flat grey, which does not need it, and it costs ~50ms and ~9MB.
   */
  zoneColours: ZoneColours | null;
  labels: ZoneMap;
  simplified: ZoneMap;
  scratch: SimplifyScratch;
  output: Rgba;
}

interface Params {
  /**
   * Positions on the `L` scale, 0–100 — the same axis the value bar and histogram are drawn on,
   * so a handle sits on the part of the distribution it cuts. The *suggestion* is still computed
   * in percentiles, which is what makes it meaningful across differently exposed photos
   * (SPEC.md §6.4); `percentilesToCuts` converts it once, when the photo loads.
   */
  cuts: Boundaries;
  greyscale: boolean;
  /**
   * Whether the dark zone is painted. Off, the darks fall back into the mid zone; the boundary
   * keeps its value either way, so switching it back on restores what was there.
   */
  showDarks: boolean;
  /** Shape simplification strength, 0–1. */
  simplify: number;
  /** Squint blur on the reference photo, 0–1. A display effect, not a pipeline stage. */
  squint: number;
  view: View;
}

const photoFrame = requireElement('photoFrame', HTMLLabelElement);
const studyFrame = requireElement('studyFrame', HTMLDivElement);
const studyPlaceholder = requireElement('studyPlaceholder', HTMLSpanElement);
const photoCaption = requireElement('photoCaption', HTMLElement);
const originalCanvas = requireCanvas('originalCanvas');
const studyCanvas = requireCanvas('studyCanvas');
const histogramCanvas = requireCanvas('histogram');

let state: ImageState | null = null;
let params: Params = {
  // Until a photo defines a real distribution these are just where the handles rest.
  cuts: { dark: DEFAULT_PERCENTILE_DARK, light: DEFAULT_PERCENTILE_LIGHT },
  greyscale: true,
  showDarks: false,
  simplify: 0,
  squint: 0,
  view: 'both',
};

/** Expensive pass: SPEC.md §4 steps 1–5. Runs once per image. */
async function runExpensivePass(file: Blob): Promise<ImageState> {
  const source = await decodeToWorkingSize(file, WORKING_RESOLUTION);
  const lab = srgbToLab(source.rgba);
  const hist = buildHistogram(lab.L, HISTOGRAM_BINS);
  const size = source.width * source.height;
  return {
    source,
    lab,
    hist,
    suggested: percentilesToCuts(
      hist,
      suggestPercentiles(lab.L, source.width, source.height),
    ),
    zoneColours: null,
    labels: new Uint8Array(size),
    simplified: new Uint8Array(size),
    scratch: createSimplifyScratch(source.width, source.height),
    output: new Uint8ClampedArray(source.rgba.length),
  };
}

function zoneColoursOf(image: ImageState): ZoneColours {
  image.zoneColours ??= buildZoneColours(image.lab.a, image.lab.b, ZONE_L);
  return image.zoneColours;
}

/** A boundary reads as the share of the picture it cuts off, not as a raw position. */
function shareBelow(image: ImageState | null, l: number): string {
  return image === null ? '—' : `${Math.round(lToPercentile(image.hist, l))}%`;
}

/**
 * Cheap pass: SPEC.md §4 steps 6–9. Runs on every control change.
 *
 * `settled` is the full-resolution pass SPEC.md §4 asks for on release. Small-region removal costs
 * roughly as much again as everything else put together, and unlike the majority filter it is a
 * finishing touch rather than the thing the Simplify slider is visibly doing — so it waits until
 * the controls stop moving.
 */
function runCheapPass(image: ImageState, current: Params, settled: boolean): void {
  const started = performance.now();
  const { width, height } = image.source;

  // Hiding the darks is a preview toggle, not an edit. Nothing has an `L` below zero, so a dark
  // boundary at zero matches nothing and every dark pixel falls into the mid zone — while the
  // boundary the painter set is left exactly where it was.
  const applied = current.showDarks
    ? current.cuts
    : { dark: 0, light: current.cuts.light };
  thresholdL(image.lab.L, applied, image.labels);

  let labels = image.labels;
  if (current.simplify > 0) {
    const settings = simplifySettings(current.simplify, width, height);
    majorityFilter(labels, width, height, settings.radius, image.scratch, image.simplified);
    labels = image.simplified;
    if (settled) {
      absorbSmallRegions(labels, width, height, settings.minArea, image.scratch, labels);
    }
  }

  if (current.greyscale) {
    renderFlat(labels, ZONE_L, image.output);
  } else {
    renderZones(labels, zoneColoursOf(image), image.output);
  }
  drawPixels(studyCanvas, image.output, width, height);

  drawHistogram(histogramCanvas, image.hist, [
    { from: 0, to: applied.dark, l: ZONE_L[0]! },
    { from: applied.dark, to: applied.light, l: ZONE_L[1]! },
    { from: applied.light, to: 100, l: ZONE_L[2]! },
  ]);

  recordCheapPassTime(performance.now() - started, settled);
}

/** Squinting is simulated as a blur on the displayed photo, scaled to how large it is drawn. */
function applySquint(current: Params): void {
  const blur = current.squint * SQUINT_MAX_BLUR_FRACTION * originalCanvas.clientWidth;
  originalCanvas.style.filter = blur > 0 ? `blur(${blur.toFixed(1)}px)` : '';
}

/**
 * SPEC.md §11 wants the per-frame cost measured rather than assumed, and the answer recorded in
 * NOTES.md. Dev builds only.
 */
const cheapPassTimes: number[] = [];
function recordCheapPassTime(ms: number, settled: boolean): void {
  if (!import.meta.env.DEV) {
    return;
  }
  if (settled) {
    console.debug(`settled pass: ${ms.toFixed(1)}ms`);
    return;
  }
  cheapPassTimes.push(ms);
  if (cheapPassTimes.length === 30) {
    const sorted = [...cheapPassTimes].sort((x, y) => x - y);
    const median = sorted[sorted.length >> 1]!;
    const worst = sorted[sorted.length - 1]!;
    console.debug(
      `cheap pass over 30 frames: median ${median.toFixed(1)}ms, worst ${worst.toFixed(1)}ms ` +
        `at ${state?.source.width}x${state?.source.height}, simplify ${params.simplify}`,
    );
    cheapPassTimes.length = 0;
  }
}

let pendingFrame = 0;
let settleTimer = 0;
function scheduleRender(): void {
  window.clearTimeout(settleTimer);
  settleTimer = window.setTimeout(() => {
    if (state && params.simplify > 0) {
      runCheapPass(state, params, true);
    }
  }, SETTLE_DELAY_MS);

  if (pendingFrame !== 0) {
    return;
  }
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = 0;
    if (state) {
      runCheapPass(state, params, false);
    }
  });
}

/** Push the current boundaries into the value bar and the readouts. */
function showCuts(): void {
  valueBar.show(params.cuts);
  valueBar.setDarkActive(params.showDarks);
  controls.showReadouts(
    shareBelow(state, params.cuts.dark),
    shareBelow(state, params.cuts.light),
  );
}

const valueBar = bindValueBar({
  onMoved: (cuts, moved) => {
    params = { ...params, cuts: clampBoundaries(cuts, moved) };
    // Dragging the dark boundary while the darks are hidden would do nothing visible, so touching
    // it switches the preview on.
    if (moved === 'dark' && !params.showDarks) {
      params = { ...params, showDarks: true };
      controls.showDarksState(true);
    }
    showCuts();
    scheduleRender();
  },
});

const controls = bindControls({
  onFile: (file) => void loadFile(file),
  onGreyscale: (on) => {
    params = { ...params, greyscale: on };
    scheduleRender();
  },
  onShowDarks: (on) => {
    params = { ...params, showDarks: on };
    valueBar.setDarkActive(on);
    scheduleRender();
  },
  onSimplify: (strength) => {
    params = { ...params, simplify: strength };
    scheduleRender();
  },
  onSquint: (strength) => {
    params = { ...params, squint: strength };
    applySquint(params);
  },
  onView: (view) => {
    params = { ...params, view };
    // The panels resize, so both the study's fit and the blur's scale change with them.
    applySquint(params);
    scheduleRender();
  },
  onReset: () => {
    if (!state) {
      return;
    }
    params = { ...params, cuts: state.suggested };
    showCuts();
    scheduleRender();
  },
});

async function loadFile(file: Blob): Promise<void> {
  try {
    state = await runExpensivePass(file);
  } catch (error) {
    state = null;
    photoFrame.classList.add('frame--empty');
    studyFrame.classList.add('frame--empty');
    studyPlaceholder.textContent = 'That image could not be opened. Try another.';
    console.error(error);
    return;
  }

  const { rgba, width, height } = state.source;
  drawPixels(originalCanvas, rgba, width, height);
  photoFrame.classList.remove('frame--empty');
  studyFrame.classList.remove('frame--empty');
  photoCaption.textContent = 'Photo — tap to change';

  // A photo opens on the suggestion, so the painter sees a usable study without touching a slider.
  params = { ...params, cuts: state.suggested };
  showCuts();
  applySquint(params);
  runCheapPass(state, params, true);
}

controls.showView(params.view);
showCuts();

// The value bar is drawn at device pixel ratio against its CSS width, the panels relayout, and the
// squint blur is scaled to the displayed photo — all three need a resize to redraw.
window.addEventListener('resize', () => {
  applySquint(params);
  scheduleRender();
});
