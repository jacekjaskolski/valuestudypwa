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
  onEstimateDepth: () => void;
  onShowDepthMap: (on: boolean) => void;
  /** The haze preview on the photo. Both values 0–1. */
  onAerial: (start: number, strength: number) => void;
  /** The lightness correction on the study. Both values 0–1. */
  onDistant: (on: boolean, start: number, strength: number) => void;
  /** Whether detail is kept in focus, and at what depth, 0–1. */
  onFocus: (on: boolean, depth: number) => void;
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
  /** The one line of prose in the photo dock: what the model is doing, or what it cost. */
  showDepthStatus: (message: string) => void;
  /**
   * Download and inference progress. A fraction shows a filled bar, null shows an indeterminate
   * one, and false hides it.
   */
  showDepthProgress: (progress: number | null | false) => void;
  /** Stops a second run being started while one is in flight. */
  setDepthBusy: (busy: boolean) => void;
  /** Reveals everything that only means something once a depth map exists. */
  setDepthAvailable: (available: boolean) => void;
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
  const estimateDepthButton = requireElement('estimateDepth', HTMLButtonElement);
  const depthStatus = requireElement('depthStatus', HTMLParagraphElement);
  const depthProgress = requireElement('depthProgress', HTMLProgressElement);
  const showDepthMapInput = requireElement('showDepthMap', HTMLInputElement);
  const showDepthMapField = requireElement('showDepthMapField', HTMLLabelElement);
  const aerialControls = requireElement('aerialControls', HTMLDivElement);
  const aerialStart = requireElement('aerialStart', HTMLInputElement);
  const aerialStartValue = requireElement('aerialStartValue', HTMLOutputElement);
  const aerialStrength = requireElement('aerialStrength', HTMLInputElement);
  const aerialStrengthValue = requireElement('aerialStrengthValue', HTMLOutputElement);
  const preserveForegroundInput = requireElement('preserveForeground', HTMLInputElement);
  const preserveForegroundField = requireElement('preserveForegroundField', HTMLLabelElement);
  const focusControl = requireElement('focusControl', HTMLDivElement);
  const focusDepth = requireElement('focusDepth', HTMLInputElement);
  const focusDepthValue = requireElement('focusDepthValue', HTMLOutputElement);
  const distantInput = requireElement('distant', HTMLInputElement);
  const distantField = requireElement('distantField', HTMLLabelElement);
  const distantControls = requireElement('distantControls', HTMLDivElement);
  const distantStart = requireElement('distantStart', HTMLInputElement);
  const distantStartValue = requireElement('distantStartValue', HTMLOutputElement);
  const distantStrength = requireElement('distantStrength', HTMLInputElement);
  const distantStrengthValue = requireElement('distantStrengthValue', HTMLOutputElement);
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
  estimateDepthButton.addEventListener('click', () => handlers.onEstimateDepth());
  showDepthMapInput.addEventListener('change', () =>
    handlers.onShowDepthMap(showDepthMapInput.checked),
  );

  const reportAerial = (): void => {
    const start = Number(aerialStart.value) / 100;
    const strength = Number(aerialStrength.value) / 100;
    aerialStartValue.textContent = formatStrength(start);
    aerialStrengthValue.textContent = formatStrength(strength);
    handlers.onAerial(start, strength);
  };
  aerialStart.addEventListener('input', reportAerial);
  aerialStrength.addEventListener('input', reportAerial);

  const reportDistant = (): void => {
    const start = Number(distantStart.value) / 100;
    const strength = Number(distantStrength.value) / 100;
    distantStartValue.textContent = formatStrength(start);
    distantStrengthValue.textContent = formatStrength(strength);
    // The sliders only appear once the effect is on; hidden ones would just take up room.
    distantControls.hidden = !distantInput.checked;
    handlers.onDistant(distantInput.checked, start, strength);
  };
  const reportFocus = (): void => {
    const depth = Number(focusDepth.value) / 100;
    focusDepthValue.textContent = formatStrength(depth);
    // The slider only appears once the effect is on; a hidden one would just take up room.
    focusControl.hidden = !preserveForegroundInput.checked;
    handlers.onFocus(preserveForegroundInput.checked, depth);
  };
  preserveForegroundInput.addEventListener('change', reportFocus);
  focusDepth.addEventListener('input', reportFocus);
  distantInput.addEventListener('change', reportDistant);
  distantStart.addEventListener('input', reportDistant);
  distantStrength.addEventListener('input', reportDistant);

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
  aerialStartValue.textContent = formatStrength(Number(aerialStart.value) / 100);
  aerialStrengthValue.textContent = formatStrength(Number(aerialStrength.value) / 100);
  distantStartValue.textContent = formatStrength(Number(distantStart.value) / 100);
  distantStrengthValue.textContent = formatStrength(Number(distantStrength.value) / 100);
  focusDepthValue.textContent = formatStrength(Number(focusDepth.value) / 100);

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
    showDepthStatus: (message) => {
      depthStatus.textContent = message;
    },
    showDepthProgress: (progress) => {
      if (progress === false) {
        depthProgress.hidden = true;
        return;
      }
      depthProgress.hidden = false;
      if (progress === null) {
        depthProgress.removeAttribute('value');
      } else {
        depthProgress.value = progress;
      }
    },
    setDepthBusy: (busy) => {
      estimateDepthButton.disabled = busy;
    },
    setDepthAvailable: (available) => {
      showDepthMapField.hidden = !available;
      aerialControls.hidden = !available;
      distantField.hidden = !available;
      preserveForegroundField.hidden = !available;
      if (!available) {
        showDepthMapInput.checked = false;
        distantInput.checked = false;
        preserveForegroundInput.checked = false;
        focusControl.hidden = true;
        distantControls.hidden = true;
      }
    },
  };
}
