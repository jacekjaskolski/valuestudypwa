/**
 * The control strip: sliders, toggles, buttons, file input.
 *
 * This module reads and writes widgets and reports plain values. It holds no pipeline state and
 * makes no decisions about what the values mean.
 */

import type { Boundaries } from '../pipeline/threshold';
import { requireElement } from './canvas';

export interface ControlHandlers {
  onFile: (file: File) => void;
  /** One of the two boundaries moved. `moved` names which, so ordering can be clamped correctly. */
  onBoundaryMoved: (boundaries: Boundaries, moved: 'dark' | 'light') => void;
  onGreyscale: (on: boolean) => void;
  onReset: () => void;
}

export interface Controls {
  /** Push model state back into the widgets, after clamping or a reset. */
  showBoundaries: (boundaries: Boundaries) => void;
  /** Reveal the study controls once there is an image to apply them to. */
  setStudyControlsVisible: (visible: boolean) => void;
  greyscale: () => boolean;
}

/**
 * Boundaries are percentiles of the image's own luminance (SPEC.md §6.4), so they read as a
 * share of the picture rather than an abstract number.
 */
function formatBoundary(percentile: number): string {
  return `${Math.round(percentile)}%`;
}

export function bindControls(handlers: ControlHandlers): Controls {
  const studyControls = requireElement('studyControls', HTMLDivElement);
  const fileInput = requireElement('fileInput', HTMLInputElement);
  const greyscaleInput = requireElement('greyscale', HTMLInputElement);
  const resetButton = requireElement('reset', HTMLButtonElement);
  const darkInput = requireElement('cutDark', HTMLInputElement);
  const lightInput = requireElement('cutLight', HTMLInputElement);
  const darkValue = requireElement('cutDarkValue', HTMLOutputElement);
  const lightValue = requireElement('cutLightValue', HTMLOutputElement);

  const readBoundaries = (): Boundaries => ({
    dark: Number(darkInput.value),
    light: Number(lightInput.value),
  });

  const showBoundaries = (boundaries: Boundaries): void => {
    darkInput.value = String(boundaries.dark);
    lightInput.value = String(boundaries.light);
    darkValue.textContent = formatBoundary(boundaries.dark);
    lightValue.textContent = formatBoundary(boundaries.light);
  };

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) {
      handlers.onFile(file);
      // Clear the input so picking the same photo again still fires `change`. The File reference
      // above survives it.
      fileInput.value = '';
    }
  });

  darkInput.addEventListener('input', () => handlers.onBoundaryMoved(readBoundaries(), 'dark'));
  lightInput.addEventListener('input', () => handlers.onBoundaryMoved(readBoundaries(), 'light'));
  greyscaleInput.addEventListener('change', () => handlers.onGreyscale(greyscaleInput.checked));
  resetButton.addEventListener('click', () => handlers.onReset());

  return {
    showBoundaries,
    setStudyControlsVisible: (visible) => {
      studyControls.hidden = !visible;
    },
    greyscale: () => greyscaleInput.checked,
  };
}
