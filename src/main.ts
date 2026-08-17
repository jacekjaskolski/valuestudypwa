/**
 * Wiring. The pipeline split from SPEC.md §4 is expressed here from the start: an expensive pass
 * that runs once per image, and a cheap pass that runs every frame while dragging. At §9 step 5
 * the expensive pass moves into a worker; keeping the seam visible now means that is a move
 * rather than a rewrite.
 */

import { WORKING_RESOLUTION } from './constants';
import {
  decodeToWorkingSize,
  drawPixels,
  requireCanvas,
  requireElement,
  type SourcePixels,
} from './ui/canvas';

/**
 * Everything the expensive pass produces for one image. LAB channels, the histogram and the depth
 * map join this as later stages land.
 */
interface ImageState {
  source: SourcePixels;
}

const panels = requireElement('panels', HTMLElement);
const emptyState = requireElement('emptyState', HTMLParagraphElement);
const fileInput = requireElement('fileInput', HTMLInputElement);
const originalCanvas = requireCanvas('originalCanvas');
const studyCanvas = requireCanvas('studyCanvas');

let state: ImageState | null = null;

/** Expensive pass: SPEC.md §4 steps 1–5. Runs once per image. */
async function runExpensivePass(file: Blob): Promise<ImageState> {
  const source = await decodeToWorkingSize(file, WORKING_RESOLUTION);
  return { source };
}

/** Cheap pass: SPEC.md §4 steps 6–9. Runs on every control change. */
function runCheapPass(image: ImageState): void {
  const { rgba, width, height } = image.source;
  drawPixels(studyCanvas, rgba, width, height);
}

async function loadFile(file: Blob): Promise<void> {
  try {
    state = await runExpensivePass(file);
  } catch (error) {
    state = null;
    panels.hidden = true;
    emptyState.hidden = false;
    emptyState.textContent = "That image could not be opened. Try another.";
    console.error(error);
    return;
  }

  const { rgba, width, height } = state.source;
  drawPixels(originalCanvas, rgba, width, height);
  panels.hidden = false;
  emptyState.hidden = true;
  runCheapPass(state);
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) {
    void loadFile(file);
  }
});
