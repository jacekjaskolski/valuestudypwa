/**
 * Wiring. The pipeline split from SPEC.md §4 is expressed here from the start: an expensive pass
 * that runs once per image, and a cheap pass that runs every frame while dragging. At §9 step 5
 * the expensive pass moves into a worker; keeping the seam visible now means that is a move
 * rather than a rewrite.
 */

import {
  AERIAL_DEFAULT_START,
  DEFAULT_PERCENTILE_DARK,
  DEFAULT_PERCENTILE_LIGHT,
  DEPTH_NEAR_IS_HIGH,
  FOCUS_DEFAULT_DEPTH,
  FOCUS_LEVELS,
  FOCUS_MAX_FALLOFF,
  HISTOGRAM_BINS,
  SQUINT_HIGHLIGHT_BLUR_RATIO,
  SQUINT_MAX_BLUR_FRACTION,
  WORKING_RESOLUTION,
  ZONE_L,
} from './constants';
import { createBlurScratch, squintBlur, type BlurScratch } from './pipeline/blur';
import { srgbToLab, type LabImage } from './pipeline/color';
import { hazeDistance, liftDistance, type AerialSettings } from './pipeline/aerial';
import { normalizeDepth, renderDepth, resampleBilinear } from './pipeline/depth';
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
  gradeDetail,
  majorityFilter,
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
import { bindStageGestures } from './ui/gestures';
import { bindSheets } from './ui/sheets';
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
  /**
   * Normalised depth at working resolution, 1 = farthest, or null until it has been estimated.
   * Aerial correction (SPEC.md §6.3) will read this; for now it only feeds the Depth view.
   */
  depth: Float32Array | null;
  /** Corrected `L`, and its histogram, rebuilt whenever the distance correction changes. */
  correctedL: Float32Array;
  /** Full-size RGBA the photo is composed into before drawing: haze, or the depth map. */
  photoBuffer: Rgba;
}

interface Params {
  /**
   * Positions on the `L` scale, 0–100 — the same axis the value bar and histogram are drawn on,
   * so a handle sits on the part of the distribution it cuts. The *suggestion* is still computed
   * in percentiles, which is what makes it meaningful across differently exposed photos
   * (SPEC.md §6.4); `percentilesToCuts` converts it once, when the photo loads.
   */
  cuts: Boundaries;
  /**
   * Always true for now: the black / grey / white study is the one being used, and the tinted
   * render has no control. `renderZones` and its precompute stay in the pipeline, tested, for when
   * SPEC.md §6.6's colour reference is wanted again.
   */
  greyscale: boolean;
  /**
   * Whether the dark zone is painted. Off, the darks fall back into the mid zone; the boundary
   * keeps its value either way, so switching it back on restores what was there.
   */
  showDarks: boolean;
  /** Shape simplification strength, 0–1. */
  simplify: number;
  /** The depth kept sharp, and how wide that band is. A width of zero keeps nothing. */
  focusDepth: number;
  focusWidth: number;
  /** Squint blur on the reference photo, 0–1. A display effect, not a pipeline stage. */
  squint: number;
  /** Whether squinting keeps bright accents where they are instead of smearing them. */
  keepHighlights: boolean;
  /** Show the depth map in place of the photo, to see what the model found. */
  showDepthMap: boolean;
  /** The haze preview on the photo. */
  aerial: AerialSettings;
  /** The lightness correction on the study. Zero strength is off. */
  distant: AerialSettings;
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
  focusDepth: FOCUS_DEFAULT_DEPTH,
  focusWidth: 0,
  squint: 0,
  keepHighlights: true,
  showDepthMap: false,
  aerial: { start: AERIAL_DEFAULT_START, strength: 0 },
  distant: { start: AERIAL_DEFAULT_START, strength: 0 },
  view: 'photo',
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
    // Two of the levels are the untouched and the fully simplified maps, which already exist;
    // the rest are the steps the focus band grades through.
    scratch: createSimplifyScratch(source.width, source.height, Math.max(0, FOCUS_LEVELS - 2)),
    output: new Uint8ClampedArray(source.rgba.length),
    blurScratch: null,
    depth: null,
    correctedL: new Float32Array(size),
    photoBuffer: new Uint8ClampedArray(source.rgba.length),
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

  // Aerial correction comes first, because it changes which zone a pixel lands in (SPEC.md §6.3).
  // The histogram is rebuilt from the corrected values so the chart, and the boundaries read
  // against it, follow the correction rather than describing an image that is no longer shown
  // (SPEC.md §7).
  const corrected = current.distant.strength > 0 && image.depth !== null;
  let L = image.lab.L;
  let hist = image.hist;
  if (corrected) {
    // Restricted to the darks. The boundary used is the painter's own, not the one the "show
    // darks" preview may have moved to zero — hiding the darks is a display toggle and must not
    // change what the correction does.
    liftDistance(
      image.lab.L,
      image.depth!,
      current.distant,
      current.cuts.dark,
      image.correctedL,
    );
    L = image.correctedL;
    hist = buildHistogram(L, HISTOGRAM_BINS);
  }

  // Hiding the darks is a preview toggle, not an edit. Nothing has an `L` below zero, so a dark
  // boundary at zero matches nothing and every dark pixel falls into the mid zone — while the
  // boundary the painter set is left exactly where it was.
  const applied = current.showDarks
    ? current.cuts
    : { dark: 0, light: current.cuts.light };
  thresholdL(L, applied, image.labels);

  let labels = image.labels;
  if (current.simplify > 0) {
    const settings = simplifySettings(current.simplify, width, height);
    simplifyLabels(labels, width, height, settings, image.scratch, image.simplified);
    labels = image.simplified;

    // Both maps already exist, so keeping the foreground sharp is a choice between them rather
    // than a second simplification pass. Written back into the simplified buffer, which is safe
    // because the unsimplified one it reads from is a different array.
    if (current.focusWidth > 0 && image.depth !== null) {
      // Sharpest first: untouched, then each intermediate simplification, then the full one. The
      // middles are only built here, so a band that is switched off costs nothing.
      const levels: ZoneMap[] = [image.labels];
      for (let step = 1; step <= image.scratch.middles.length; step++) {
        const middle = image.scratch.middles[step - 1]!;
        const radius = Math.round((settings.radius * step) / (FOCUS_LEVELS - 1));
        majorityFilter(image.labels, width, height, radius, image.scratch, middle);
        levels.push(middle);
      }
      levels.push(image.simplified);

      gradeDetail(
        levels,
        image.depth,
        current.focusDepth,
        current.focusWidth * FOCUS_MAX_FALLOFF,
        image.simplified,
      );
    }
  }

  if (current.greyscale) {
    renderFlat(labels, ZONE_L, image.output);
  } else {
    renderZones(labels, zoneColoursOf(image), image.output);
  }
  drawPixels(studyCanvas, image.output, width, height);

  drawHistogram(histogramCanvas, hist, [
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
  const { width, height } = image.source;

  // What the photo panel shows, before squinting: the depth map, the hazed photo, or the photo.
  let rgba = image.source.rgba;
  if (image.depth !== null && current.showDepthMap) {
    rgba = renderDepth(image.depth, image.photoBuffer);
  } else if (image.depth !== null && current.aerial.strength > 0) {
    rgba = hazeDistance(image.source.rgba, image.depth, current.aerial, image.photoBuffer);
  }

  if (current.squint <= 0) {
    drawPixels(originalCanvas, rgba, width, height);
    return;
  }

  image.blurScratch ??= createBlurScratch(image.source.rgba.length);
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

const sheets = bindSheets();

/**
 * The single place a view change lands: the panels, the tools that act on them, and the render.
 * Called both by the switch and by a swipe, so the two cannot drift.
 */
function applyView(view: View): void {
  params = { ...params, view };
  controls.showView(view);
  sheets.setView(view);
  scheduleRender();
}

const controls = bindControls({
  onFile: (file) => void loadFile(file),
  onShowDarks: (on) => {
    params = { ...params, showDarks: on };
    valueBar.setDarkActive(on);
    scheduleRender();
  },
  onSimplify: (strength) => {
    params = { ...params, simplify: strength };
    scheduleRender();
  },
  onFocus: (depth, width) => {
    params = { ...params, focusDepth: depth, focusWidth: width };
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
  onView: applyView,
  onEstimateDepth: () => void estimateDepthForCurrentImage(),
  onShowDepthMap: (on) => {
    params = { ...params, showDepthMap: on };
    schedulePhoto();
  },
  onAerial: (start, strength) => {
    params = { ...params, aerial: { start, strength } };
    schedulePhoto();
  },
  onDistant: (start, strength) => {
    params = { ...params, distant: { start, strength } };
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

/**
 * Estimate depth for the loaded photo and show it (SPEC.md §6.2).
 *
 * Deliberately behind a button rather than automatic: the first run downloads tens of megabytes.
 * The model is imported dynamically so none of it is fetched, parsed or cached until asked for.
 *
 * Every failure path leaves the rest of the app untouched. Depth is an enhancement, not a
 * dependency — if this never succeeds, the study is exactly what it was.
 */
async function estimateDepthForCurrentImage(): Promise<void> {
  const image = state;
  if (!image) {
    controls.showDepthStatus('Load a photo first.');
    return;
  }

  controls.setDepthBusy(true);
  controls.showDepthStatus('Loading model…');
  controls.showDepthProgress(null);

  try {
    const { estimateDepth } = await import('./model/depth');
    const { width, height } = image.source;

    const result = await estimateDepth(image.source.rgba, width, height, (progress) => {
      controls.showDepthProgress(progress.fraction);
      controls.showDepthStatus(
        progress.fraction === null
          ? 'Loading model…'
          : `Downloading model… ${Math.round(progress.fraction * 100)}%`,
      );
    });

    // The download reports progress; the inference that follows does not, so the bar goes
    // indeterminate rather than sitting at 100% while the model is still thinking.
    controls.showDepthProgress(null);

    // Normalise at the model's own resolution, then stretch to ours: the range belongs to the
    // model's output, and resampling first would blur the extremes that define it.
    const normalized = new Float32Array(result.width * result.height);
    normalizeDepth(result.raw, DEPTH_NEAR_IS_HIGH, normalized);

    const full = new Float32Array(width * height);
    resampleBilinear(normalized, result.width, result.height, full, width, height);
    image.depth = full;

    controls.setDepthAvailable(true);
    // The sliders appearing is the confirmation; the timings were a developer's note.
    controls.showDepthStatus('');
    drawPhoto(image, params);
  } catch (error) {
    // Put the actual reason on screen. A generic message is useless on a phone or tablet, where
    // there is no console to look in and the only report available is what the app says.
    const reason = error instanceof Error ? error.message : String(error);
    const { backendReport } = await import('./model/depth');
    controls.showDepthStatus(
      `Depth failed: ${reason.slice(0, 200)} [${backendReport()}]. The study is unaffected.`,
    );
    console.error(error);
  } finally {
    controls.setDepthBusy(false);
    controls.showDepthProgress(false);
  }
}

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
  // Show what was just loaded. Turning it into a study is the painter's decision, not ours.
  applyView('photo');
  // A new photo invalidates the old depth map, and everything that depended on it.
  controls.setDepthAvailable(false);
  // Anything the old depth map was driving is reset by `setDepthAvailable(false)` above.
  params = { ...params, showDepthMap: false };
  controls.showDepthStatus('Not estimated for this photo yet.');

  // A photo opens on the suggestion, so the painter sees a usable study without touching a slider.
  params = { ...params, cuts: state.suggested };
  showCuts();
  runCheapPass(state, params);
}

bindStageGestures({
  peek: () => controls.otherView(),
  commit: () => controls.toggleView(),
  tap: () => sheets.close(),
});

applyView(params.view);
showCuts();

// The value bar is drawn at device pixel ratio against its CSS width, so a resize needs a redraw
// to stay crisp. The photo does not: its blur is in source pixels, not displayed ones.
window.addEventListener('resize', scheduleRender);
