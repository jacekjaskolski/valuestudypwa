/**
 * Pointer gestures on the image.
 *
 * A horizontal swipe steps the view, so the photo and the study can be compared without reaching
 * for anything — the switch is still there for a deliberate change, and this is for the quick
 * back-and-forth that comparing actually is.
 *
 * Tap and swipe are told apart here rather than in two listeners, because they are the same
 * gesture until the finger lifts. Deciding separately is how a swipe ends up also counting as a
 * tap, which would dismiss the sheet every time the view was flicked.
 */

/** How far a finger must travel horizontally to count as a swipe rather than a tap. */
const SWIPE_DISTANCE = 45;

/**
 * How much more horizontal than vertical the travel must be. Without it, a diagonal drag reads as
 * a swipe, and a scroll-like gesture would change the view.
 */
const SWIPE_BIAS = 1.5;

/** Anything that moves less than this is a tap, however long the finger rests. */
const TAP_SLOP = 10;

export interface GestureHandlers {
  /** A press and release that went nowhere. */
  onTap: () => void;
  /** `1` for a leftward swipe, meaning "next"; `-1` for the other way. */
  onSwipe: (direction: 1 | -1) => void;
}

export function bindStageGestures(element: Element, handlers: GestureHandlers): void {
  let pointer: number | null = null;
  let startX = 0;
  let startY = 0;

  element.addEventListener('pointerdown', (event) => {
    const pointerEvent = event as PointerEvent;
    // Ignore a second finger: a pinch is not a swipe, and following both would average them.
    if (pointer !== null) {
      return;
    }
    pointer = pointerEvent.pointerId;
    startX = pointerEvent.clientX;
    startY = pointerEvent.clientY;
  });

  const finish = (event: Event): void => {
    const pointerEvent = event as PointerEvent;
    if (pointer !== pointerEvent.pointerId) {
      return;
    }
    pointer = null;

    const dx = pointerEvent.clientX - startX;
    const dy = pointerEvent.clientY - startY;

    if (Math.abs(dx) >= SWIPE_DISTANCE && Math.abs(dx) > Math.abs(dy) * SWIPE_BIAS) {
      handlers.onSwipe(dx < 0 ? 1 : -1);
      return;
    }
    if (Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) {
      handlers.onTap();
    }
  };

  element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', () => {
    pointer = null;
  });
}
