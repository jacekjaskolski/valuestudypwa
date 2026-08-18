/**
 * The value bar: both boundaries as handles on one axis, over the histogram they cut.
 *
 * Positions are on the `L` scale, 0–100 across the bar's width — the same axis the histogram is
 * drawn on, so a handle sits exactly on the part of the distribution it is cutting. That is the
 * reason this control replaced two separate range inputs: with the histogram as a background
 * rather than a chart underneath, a thumb that did not line up with its own marker read as broken.
 *
 * Reports positions and nothing else; it holds no pipeline state.
 */

import type { Boundaries } from '../pipeline/threshold';
import { requireElement } from './canvas';

export interface ValueBarHandlers {
  /** A boundary moved. `moved` names which, so ordering can be clamped correctly. */
  onMoved: (boundaries: Boundaries, moved: 'dark' | 'light') => void;
}

export interface ValueBar {
  /** Push model state back into the handles, after clamping or a reset. */
  show: (boundaries: Boundaries) => void;
  /** Grey the dark handle while its boundary is held but not cutting. */
  setDarkActive: (active: boolean) => void;
}

/** Keyboard step, in `L` units. Arrow keys move by this, Page keys by the coarse step. */
const KEY_STEP = 1;
const KEY_STEP_COARSE = 10;

function clamp(value: number): number {
  return value < 0 ? 0 : value > 100 ? 100 : value;
}

export function bindValueBar(handlers: ValueBarHandlers): ValueBar {
  const bar = requireElement('valueBar', HTMLDivElement);
  const darkHandle = requireElement('darkHandle', HTMLDivElement);
  const lightHandle = requireElement('lightHandle', HTMLDivElement);

  let current: Boundaries = { dark: 0, light: 100 };

  const show = (boundaries: Boundaries): void => {
    current = boundaries;
    darkHandle.style.left = `${boundaries.dark}%`;
    lightHandle.style.left = `${boundaries.light}%`;
    darkHandle.setAttribute('aria-valuenow', String(Math.round(boundaries.dark)));
    lightHandle.setAttribute('aria-valuenow', String(Math.round(boundaries.light)));
  };

  /** Where along the `L` axis a pointer is, 0–100. */
  const positionOf = (event: PointerEvent): number => {
    const rect = bar.getBoundingClientRect();
    return clamp(((event.clientX - rect.left) / rect.width) * 100);
  };

  const move = (which: 'dark' | 'light', to: number): void => {
    const at = clamp(to);
    handlers.onMoved(
      which === 'dark'
        ? { dark: at, light: current.light }
        : { dark: current.dark, light: at },
      which,
    );
  };

  /**
   * `grip` is the distance between the pointer and the boundary at the moment it was grabbed, in
   * `L` units. Dragging preserves it, so grabbing a handle near its edge does not snap the
   * boundary under the finger. Pressing the bar itself grabs with no offset, which is what makes
   * that a jump-to-position.
   */
  const startDrag = (which: 'dark' | 'light', event: PointerEvent, grip: number): void => {
    const handle = which === 'dark' ? darkHandle : lightHandle;
    handle.setPointerCapture(event.pointerId);
    handle.focus();

    const onPointerMove = (moveEvent: PointerEvent): void => {
      move(which, positionOf(moveEvent) + grip);
    };
    const onPointerUp = (): void => {
      handle.removeEventListener('pointermove', onPointerMove);
      handle.removeEventListener('pointerup', onPointerUp);
      handle.removeEventListener('pointercancel', onPointerUp);
    };

    handle.addEventListener('pointermove', onPointerMove);
    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerUp);
  };

  for (const [which, handle] of [
    ['dark', darkHandle],
    ['light', lightHandle],
  ] as const) {
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      // Stop the bar's own handler from treating this as a jump-to-position.
      event.stopPropagation();
      startDrag(which, event, current[which] - positionOf(event));
    });

    handle.addEventListener('keydown', (event) => {
      const step =
        event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? -KEY_STEP
          : event.key === 'ArrowRight' || event.key === 'ArrowUp'
            ? KEY_STEP
            : event.key === 'PageDown'
              ? -KEY_STEP_COARSE
              : event.key === 'PageUp'
                ? KEY_STEP_COARSE
                : 0;

      if (step !== 0) {
        event.preventDefault();
        move(which, current[which] + step);
      } else if (event.key === 'Home') {
        event.preventDefault();
        move(which, 0);
      } else if (event.key === 'End') {
        event.preventDefault();
        move(which, 100);
      }
    });
  }

  // Pressing the bar itself grabs whichever boundary is nearer, so a boundary can be put straight
  // onto a peak instead of dragged to it.
  bar.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const at = positionOf(event);
    const which =
      Math.abs(at - current.dark) <= Math.abs(at - current.light) ? 'dark' : 'light';
    startDrag(which, event, 0);
    move(which, at);
  });

  return {
    show,
    setDarkActive: (active) => {
      darkHandle.classList.toggle('valuebar__handle--muted', !active);
    },
  };
}
