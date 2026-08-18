/**
 * The control strip: toggles, buttons, file input, and the numeric readouts above the value bar.
 * The two boundaries themselves live in `valuebar.ts`.
 *
 * This module reads and writes widgets and reports plain values. It holds no pipeline state and
 * makes no decisions about what the values mean.
 */

import { requireElement } from './canvas';

export interface ControlHandlers {
  onFile: (file: File) => void;
  onGreyscale: (on: boolean) => void;
  onShowDarks: (on: boolean) => void;
  onReset: () => void;
}

export interface Controls {
  /**
   * Write the two boundary readouts. Formatted by the caller, which is the only place that knows
   * the image's own distribution — a boundary is shown as the share of the picture it cuts off,
   * not as a raw position (SPEC.md §7, label by what the painter is doing).
   */
  showReadouts: (dark: string, light: string) => void;
  /** Reflect the dark preview being switched on by something other than its own checkbox. */
  showDarksState: (on: boolean) => void;
  greyscale: () => boolean;
  showDarks: () => boolean;
}

export function bindControls(handlers: ControlHandlers): Controls {
  const fileInput = requireElement('fileInput', HTMLInputElement);
  const greyscaleInput = requireElement('greyscale', HTMLInputElement);
  const showDarksInput = requireElement('showDarks', HTMLInputElement);
  const resetButton = requireElement('reset', HTMLButtonElement);
  const darkValue = requireElement('cutDarkValue', HTMLOutputElement);
  const lightValue = requireElement('cutLightValue', HTMLOutputElement);

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) {
      handlers.onFile(file);
      // Clear the input so picking the same photo again still fires `change`. The File reference
      // above survives it.
      fileInput.value = '';
    }
  });

  greyscaleInput.addEventListener('change', () => handlers.onGreyscale(greyscaleInput.checked));
  showDarksInput.addEventListener('change', () => handlers.onShowDarks(showDarksInput.checked));
  resetButton.addEventListener('click', () => handlers.onReset());

  return {
    showReadouts: (dark, light) => {
      darkValue.textContent = dark;
      lightValue.textContent = light;
    },
    showDarksState: (on) => {
      showDarksInput.checked = on;
    },
    greyscale: () => greyscaleInput.checked,
    showDarks: () => showDarksInput.checked,
  };
}
