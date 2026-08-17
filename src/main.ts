/**
 * Wiring. The pipeline split from SPEC.md §4 is expressed here from the start: an expensive pass
 * that runs once per image, and a cheap pass that runs every frame while dragging. At §9 step 5
 * the expensive pass moves into a worker; keeping the seam visible now means that is a move
 * rather than a rewrite.
 */

import {
  DEFAULT_CUT_DARK,
  DEFAULT_CUT_LIGHT,
  WORKING_RESOLUTION,
  ZONE_L,
} from './constants';
import { srgbToLab, type LabImage } from './pipeline/color';
import { renderZones } from './pipeline/render';
import { clampCuts, thresholdL, type Cuts, type ZoneMap } from './pipeline/threshold';
import type { Rgba } from './pipeline/types';
import {
  decodeToWorkingSize,
  drawPixels,
  requireCanvas,
  requireElement,
  type SourcePixels,
} from './ui/canvas';
import { bindControls } from './ui/controls';

/**
 * Everything the expensive pass produces for one image, plus the buffers the cheap pass reuses so
 * that dragging allocates nothing. The histogram and depth map join this as later stages land.
 */
interface ImageState {
  source: SourcePixels;
  lab: LabImage;
  labels: ZoneMap;
  output: Rgba;
}

interface Params {
  cuts: Cuts;
  greyscale: boolean;
}

const panels = requireElement('panels', HTMLElement);
const emptyState = requireElement('emptyState', HTMLParagraphElement);
const originalCanvas = requireCanvas('originalCanvas');
const studyCanvas = requireCanvas('studyCanvas');

let state: ImageState | null = null;
let params: Params = {
  cuts: { dark: DEFAULT_CUT_DARK, light: DEFAULT_CUT_LIGHT },
  greyscale: false,
};

/** Expensive pass: SPEC.md §4 steps 1–5. Runs once per image. */
async function runExpensivePass(file: Blob): Promise<ImageState> {
  const source = await decodeToWorkingSize(file, WORKING_RESOLUTION);
  const lab = srgbToLab(source.rgba);
  return {
    source,
    lab,
    labels: new Uint8Array(source.width * source.height),
    output: new Uint8ClampedArray(source.rgba.length),
  };
}

/** Cheap pass: SPEC.md §4 steps 6–9. Runs on every control change. */
function runCheapPass(image: ImageState, current: Params): void {
  const started = performance.now();

  thresholdL(image.lab.L, current.cuts, image.labels);
  renderZones(
    image.labels,
    image.lab.a,
    image.lab.b,
    ZONE_L,
    { greyscale: current.greyscale },
    image.output,
  );
  drawPixels(studyCanvas, image.output, image.source.width, image.source.height);

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
  onCutMoved: (cuts, moved) => {
    params = { ...params, cuts: clampCuts(cuts, moved) };
    controls.showCuts(params.cuts);
    scheduleRender();
  },
  onGreyscale: (on) => {
    params = { ...params, greyscale: on };
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
  runCheapPass(state, params);
}

controls.showCuts(params.cuts);
