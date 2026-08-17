/**
 * The control strip: sliders, toggles, file input.
 *
 * This module reads and writes widgets and reports plain values. It holds no pipeline state and
 * makes no decisions about what the values mean.
 */

import type { Cuts } from '../pipeline/threshold';
import { requireElement } from './canvas';

export interface ControlHandlers {
  onFile: (file: File) => void;
  /** One of the two boundaries moved. `moved` names which, so ordering can be clamped correctly. */
  onCutMoved: (cuts: Cuts, moved: 'dark' | 'light') => void;
  onGreyscale: (on: boolean) => void;
}

export interface Controls {
  /** Push model state back into the widgets, after clamping or a reset. */
  showCuts: (cuts: Cuts) => void;
  /** Reveal the study controls once there is an image to apply them to. */
  setStudyControlsVisible: (visible: boolean) => void;
  greyscale: () => boolean;
}

/** How a boundary's position is written next to its label. */
function formatCut(value: number): string {
  return String(Math.round(value));
}

export function bindControls(handlers: ControlHandlers): Controls {
  const studyControls = requireElement('studyControls', HTMLDivElement);
  const fileInput = requireElement('fileInput', HTMLInputElement);
  const greyscaleInput = requireElement('greyscale', HTMLInputElement);
  const darkInput = requireElement('cutDark', HTMLInputElement);
  const lightInput = requireElement('cutLight', HTMLInputElement);
  const darkValue = requireElement('cutDarkValue', HTMLOutputElement);
  const lightValue = requireElement('cutLightValue', HTMLOutputElement);

  const readCuts = (): Cuts => ({
    dark: Number(darkInput.value),
    light: Number(lightInput.value),
  });

  const showCuts = (cuts: Cuts): void => {
    darkInput.value = String(cuts.dark);
    lightInput.value = String(cuts.light);
    darkValue.textContent = formatCut(cuts.dark);
    lightValue.textContent = formatCut(cuts.light);
  };

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) {
      handlers.onFile(file);
    }
  });

  darkInput.addEventListener('input', () => handlers.onCutMoved(readCuts(), 'dark'));
  lightInput.addEventListener('input', () => handlers.onCutMoved(readCuts(), 'light'));
  greyscaleInput.addEventListener('change', () => handlers.onGreyscale(greyscaleInput.checked));

  return {
    showCuts,
    setStudyControlsVisible: (visible) => {
      studyControls.hidden = !visible;
    },
    greyscale: () => greyscaleInput.checked,
  };
}
