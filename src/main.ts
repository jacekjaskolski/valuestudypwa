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
  SQUINT_HIGHLIGHT_BLUR_RATIO,
  SQUINT_MAX_BLUR_FRACTION,
  WORKING_RESOLUTION,
  ZONE_L,
} from './constants';
import { createBlurScratch, squintBlur, type BlurScratch } from './pipeline/blur';
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
  createSimplifyScratch,
  simplifyLabels,
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
  drawPixelsScaled,
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
  /** Built on first squint: three more full-size buffers, and most sessions never squint. */
  blurScratch: BlurScratch | null;
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
  /** Whether squinting keeps bright accents where they are instead of smearing them. */
  keepHighlights: boolean;
  view: View;
}

const photoFrame = requireElement('photoFrame', HTMLDivElement);
const studyFrame = requireElement('studyFrame', HTMLDivElement);
const studyPlaceholder = requireElement('studyPlaceholder', HTMLSpanElement);
const originalCanvas = requireCanvas('originalCanvas');
const studyCanvas = requireCanvas('studyCanvas');
const histogramCanvas = requireCanvas('histogram');

let state: ImageState | null = null;
let params: Params = {
  // Until a photo defines a real distribution these are just where the handles rest.
  cuts: { dark: DEFAULT_PERCENTILE_DARK, light: DEFAULT_PERCENTILE_LIGHT },
  greyscale: true,
  showDarks: false,
  // These three mirror the markup's own defaults; `index.html` is the other half of each.
  simplify: 0.1,
  squint: 0,
  keepHighlights: true,
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
    blurScratch: null,
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
 * Simplification runs in full before anything is drawn. An earlier version ran only the cheap half
 * during a drag and finished the job once the controls settled, which was faster but made the
 * study visibly change again a moment after the finger stopped — and a study that keeps moving
 * after you do is worse than one that updates a few times a second. See NOTES.md.
 */
function runCheapPass(image: ImageState, current: Params): void {
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
    simplifyLabels(labels, width, height, settings, image.scratch, image.simplified);
    labels = image.simplified;
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

  recordCheapPassTime(performance.now() - started);
}

/**
 * Draw the reference photo, squinted if the slider asks for it.
 *
 * The blur is computed over the photo's own pixels rather than applied as a CSS or SVG filter, so
 * that it clamps at the edges instead of blurring against the transparency outside them. A filter
 * either fades the border out or leaves a ring of sharp pixels around it; both are artifacts right
 * where a painter is reading the composition. Being the same size as the source, the result also
 * needs no cropping afterwards. See `pipeline/blur.ts`.
 *
 * The sigma is a fraction of the *source* width, so squinting means the same thing regardless of
 * how large the photo happens to be drawn.
 */
function drawPhoto(image: ImageState, current: Params): void {
  const { rgba, width, height } = image.source;

  if (current.squint <= 0) {
    drawPixels(originalCanvas, rgba, width, height);
    return;
  }

  image.blurScratch ??= createBlurScratch(rgba.length);
  const started = performance.now();
  const blurred = squintBlur(
    rgba,
    width,
    height,
    current.squint * SQUINT_MAX_BLUR_FRACTION * width,
    current.keepHighlights,
    SQUINT_HIGHLIGHT_BLUR_RATIO,
    image.blurScratch,
  );
  if (blurred.factor === 1) {
    // Nothing was reduced, so draw it straight rather than round-tripping through a resample.
    drawPixels(originalCanvas, blurred.pixels, width, height);
  } else {
    drawPixelsScaled(
      originalCanvas,
      blurred.pixels,
      blurred.width,
      blurred.height,
      blurred.factor,
      width,
      height,
    );
  }

  if (import.meta.env.DEV) {
    console.debug(
      `squint: ${(performance.now() - started).toFixed(1)}ms at ` +
        `${blurred.width}x${blurred.height}`,
    );
  }
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
        `at ${state?.source.width}x${state?.source.height}, simplify ${params.simplify}`,
    );
    cheapPassTimes.length = 0;
  }
}

let pendingPhotoFrame = 0;
function schedulePhoto(): void {
  if (pendingPhotoFrame !== 0) {
    return;
  }
  pendingPhotoFrame = requestAnimationFrame(() => {
    pendingPhotoFrame = 0;
    if (state) {
      drawPhoto(state, params);
    }
  });
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
    schedulePhoto();
  },
  onKeepHighlights: (on) => {
    params = { ...params, keepHighlights: on };
    schedulePhoto();
  },
  onView: (view) => {
    params = { ...params, view };
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

  drawPhoto(state, params);
  photoFrame.classList.remove('frame--empty');
  studyFrame.classList.remove('frame--empty');
  controls.showLoaded(true);

  // A photo opens on the suggestion, so the painter sees a usable study without touching a slider.
  params = { ...params, cuts: state.suggested };
  showCuts();
  runCheapPass(state, params);
}

controls.showView(params.view);
showCuts();

// The value bar is drawn at device pixel ratio against its CSS width, so a resize needs a redraw
// to stay crisp. The photo does not: its blur is in source pixels, not displayed ones.
window.addEventListener('resize', scheduleRender);
