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
  /** The lightness correction on the study; zero strength is off. Both values 0–1. */
  onDistant: (start: number, strength: number) => void;
  /** Where detail is kept and how wide the band is; zero width is off. Both 0–1. */
  onFocus: (depth: number, width: number) => void;
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
  /**
   * The image a swipe would bring up: the other one of the pair, or `null` side by side, where
   * both are already there. Swiping never reaches the side-by-side view — that is a deliberate
   * choice made at the switch, not something to land on by accident.
   */
  otherView: () => 'photo' | 'study' | null;
  /** Switch to whatever `otherView` reports. */
  toggleView: () => void;
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
  const showDarksInput = requireElement('showDarks', HTMLInputElement);
  const simplifyInput = requireElement('simplify', HTMLInputElement);
  const simplifyValue = requireElement('simplifyValue', HTMLOutputElement);
  const squintInput = requireElement('squint', HTMLInputElement);
  const squintValue = requireElement('squintValue', HTMLOutputElement);
  const keepHighlightsInput = requireElement('keepHighlights', HTMLInputElement);
  const loadLabel = requireElement('loadLabel', HTMLSpanElement);
  const loadButton = requireElement('loadButton', HTMLLabelElement);
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
  const focusControl = requireElement('focusControl', HTMLDivElement);
  const focusDepth = requireElement('focusDepth', HTMLInputElement);
  const focusDepthValue = requireElement('focusDepthValue', HTMLOutputElement);
  const focusWidth = requireElement('focusWidth', HTMLInputElement);
  const focusWidthValue = requireElement('focusWidthValue', HTMLOutputElement);
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
    handlers.onDistant(start, strength);
  };
  distantStart.addEventListener('input', reportDistant);
  distantStrength.addEventListener('input', reportDistant);

  const reportFocus = (): void => {
    const depth = Number(focusDepth.value) / 100;
    const width = Number(focusWidth.value) / 100;
    focusDepthValue.textContent = formatStrength(depth);
    focusWidthValue.textContent = formatStrength(width);
    handlers.onFocus(depth, width);
  };
  focusDepth.addEventListener('input', reportFocus);
  focusWidth.addEventListener('input', reportFocus);

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

  let current: View = 'photo';

  const showView = (view: View): void => {
    current = view;
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

  /*
   * Side by side is only offered where there is room, and this is the only place that decides it:
   * the button is hidden from here rather than by a matching media query in the stylesheet. Two
   * copies of the same question drift, and when they do the button disappears while the view stays
   * selected — two images in a space that cannot hold one, which is the failure this layout exists
   * to fix.
   *
   * The height condition is what keeps a phone in landscape out. It is wide enough on its own, but
   * a stage barely 200px tall does not want dividing in two.
   */
  const roomForBoth = window.matchMedia(
    '(min-width: 720px) and (min-height: 520px) and (min-aspect-ratio: 1/1)',
  );
  const bothButton = viewButtons.find((button) => button.dataset['view'] === 'both');

  /** The opposite of whichever single image is showing. Side by side there is no opposite. */
  const otherView = (): 'photo' | 'study' | null =>
    current === 'photo' ? 'study' : current === 'study' ? 'photo' : null;

  const offerBoth = (): void => {
    if (bothButton) {
      bothButton.hidden = !roomForBoth.matches;
    }
    if (current === 'both' && !roomForBoth.matches) {
      showView('study');
      handlers.onView('study');
    }
  };
  roomForBoth.addEventListener('change', offerBoth);
  offerBoth();

  simplifyValue.textContent = formatStrength(Number(simplifyInput.value) / 100);
  squintValue.textContent = formatStrength(Number(squintInput.value) / 100);
  aerialStartValue.textContent = formatStrength(Number(aerialStart.value) / 100);
  aerialStrengthValue.textContent = formatStrength(Number(aerialStrength.value) / 100);
  distantStartValue.textContent = formatStrength(Number(distantStart.value) / 100);
  distantStrengthValue.textContent = formatStrength(Number(distantStrength.value) / 100);
  focusDepthValue.textContent = formatStrength(Number(focusDepth.value) / 100);
  focusWidthValue.textContent = formatStrength(Number(focusWidth.value) / 100);

  return {
    showReadouts: (dark, light) => {
      darkValue.textContent = dark;
      lightValue.textContent = light;
    },
    showDarksState: (on) => {
      showDarksInput.checked = on;
    },
    showView,
    otherView,
    toggleView: () => {
      const next = otherView();
      if (next !== null) {
        showView(next);
        handlers.onView(next);
      }
    },
    showLoaded: (loaded) => {
      // The label is visually hidden behind an icon, so it is also the tooltip.
      const text = loaded ? 'Replace photo' : 'Load photo';
      loadLabel.textContent = text;
      loadButton.title = text;
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
      distantControls.hidden = !available;
      focusControl.hidden = !available;
      if (!available) {
        // A new photo has no depth yet, so everything driven by it goes back to off rather than
        // silently carrying the last photo's settings into this one.
        showDepthMapInput.checked = false;
        aerialStrength.value = '0';
        distantStrength.value = '0';
        focusWidth.value = '0';
        reportAerial();
        reportDistant();
        reportFocus();
      }
    },
  };
}
