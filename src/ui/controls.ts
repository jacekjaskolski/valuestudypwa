/**
 * The control strip: view switch, plain sliders, toggles, buttons, file input, and the numeric
 * readouts above the value bar. The two boundaries themselves live in `valuebar.ts`.
 *
 * This module reads and writes widgets and reports plain values. It holds no pipeline state and
 * makes no decisions about what the values mean.
 */

import { requireElement } from './canvas';

/** Which panels are on screen. Controls that make no sense for the view are hidden by CSS. */
export type View = 'both' | 'photo' | 'study';

function isView(value: string | null): value is View {
  return value === 'both' || value === 'photo' || value === 'study';
}

export interface ControlHandlers {
  onFile: (file: File) => void;
  onGreyscale: (on: boolean) => void;
  onShowDarks: (on: boolean) => void;
  /** 0–1. */
  onSimplify: (strength: number) => void;
  /** 0–1. */
  onSquint: (strength: number) => void;
  onKeepHighlights: (on: boolean) => void;
  onView: (view: View) => void;
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
  showView: (view: View) => void;
  /** Once a photo is loaded, the load button becomes a replace button. */
  showLoaded: (loaded: boolean) => void;
}

/** A strength slider reads as a plain percentage, and says "off" when it is doing nothing. */
function formatStrength(strength: number): string {
  return strength === 0 ? 'off' : `${Math.round(strength * 100)}%`;
}

export function bindControls(handlers: ControlHandlers): Controls {
  const app = requireElement('app', HTMLDivElement);
  const fileInput = requireElement('fileInput', HTMLInputElement);
  const greyscaleInput = requireElement('greyscale', HTMLInputElement);
  const showDarksInput = requireElement('showDarks', HTMLInputElement);
  const simplifyInput = requireElement('simplify', HTMLInputElement);
  const simplifyValue = requireElement('simplifyValue', HTMLOutputElement);
  const squintInput = requireElement('squint', HTMLInputElement);
  const squintValue = requireElement('squintValue', HTMLOutputElement);
  const keepHighlightsInput = requireElement('keepHighlights', HTMLInputElement);
  const loadLabel = requireElement('loadLabel', HTMLSpanElement);
  const resetButton = requireElement('reset', HTMLButtonElement);
  const darkValue = requireElement('cutDarkValue', HTMLOutputElement);
  const lightValue = requireElement('cutLightValue', HTMLOutputElement);
  const viewButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.segmented__button'),
  );

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

  simplifyInput.addEventListener('input', () => {
    const strength = Number(simplifyInput.value) / 100;
    simplifyValue.textContent = formatStrength(strength);
    handlers.onSimplify(strength);
  });

  keepHighlightsInput.addEventListener('change', () =>
    handlers.onKeepHighlights(keepHighlightsInput.checked),
  );

  squintInput.addEventListener('input', () => {
    const strength = Number(squintInput.value) / 100;
    squintValue.textContent = formatStrength(strength);
    handlers.onSquint(strength);
  });

  const showView = (view: View): void => {
    app.dataset['view'] = view;
    for (const button of viewButtons) {
      button.setAttribute('aria-pressed', String(button.dataset['view'] === view));
    }
  };

  for (const button of viewButtons) {
    button.addEventListener('click', () => {
      const view = button.dataset['view'] ?? null;
      if (isView(view)) {
        showView(view);
        handlers.onView(view);
      }
    });
  }

  simplifyValue.textContent = formatStrength(Number(simplifyInput.value) / 100);
  squintValue.textContent = formatStrength(Number(squintInput.value) / 100);

  return {
    showReadouts: (dark, light) => {
      darkValue.textContent = dark;
      lightValue.textContent = light;
    },
    showDarksState: (on) => {
      showDarksInput.checked = on;
    },
    showView,
    showLoaded: (loaded) => {
      loadLabel.textContent = loaded ? 'Replace photo' : 'Load photo';
    },
  };
}
