/**
 * Pointer gestures on the image.
 *
 * A horizontal drag uncovers the other image, the way a before-and-after slider does: neither
 * picture moves, the top one is simply clipped back by the drag. Sliding both instead reads as
 * flipping between two pictures rather than looking through one at the other.
 *
 * The switch is still there for a deliberate change; this is for the quick back-and-forth that
 * comparing actually is.
 *
 * Tap and drag are recognised here together rather than in two listeners, because they are the
 * same gesture until the finger lifts. Deciding separately is how a swipe ends up also counting as
 * a tap, which would dismiss the open sheet every time the view was flicked.
 */

/** How far a finger must travel horizontally before it is a drag rather than a press. */
const DRAG_SLOP = 12;

/** How much more horizontal than vertical the travel must be, so a diagonal is not a swipe. */
const DRAG_BIAS = 1.2;

/**
 * How much of the width must be uncovered before releasing hands over; short of it, it closes
 * back. Half, so the gesture reads as "pull the other one across" rather than a flick that can be
 * triggered by accident.
 */
const COMMIT_FRACTION = 0.5;

/** Anything that moves less than this is a tap, however long the finger rests. */
const TAP_SLOP = 10;

/** Long enough to read as a hand-over, short enough not to be waited on. Matches the CSS. */
const SETTLE_MS = 170;

export interface StageGestureHandlers {
  /**
   * The image a drag would uncover, or `null` if there is nothing to uncover — which is the case
   * side by side, where both are already on screen.
   */
  peek: () => 'photo' | 'study' | null;
  commit: () => void;
  tap: () => void;
}

export function bindStageGestures(handlers: StageGestureHandlers): void {
  const stage = document.querySelector<HTMLElement>('.stage');
  const photo = document.querySelector<HTMLElement>('.panel--photo');
  const study = document.querySelector<HTMLElement>('.panel--study');
  if (!stage || !photo || !study) {
    return;
  }

  let pointer: number | null = null;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  /** The panel being clipped back, and the one it is uncovering. Null when not previewing. */
  let leaving: HTMLElement | null = null;
  let arriving: HTMLElement | null = null;
  let settling = false;

  const clear = (): void => {
    stage.classList.remove('stage--dragging', 'stage--settling');
    for (const panel of [photo, study]) {
      panel.classList.remove('panel--over', 'panel--under');
      panel.style.clipPath = '';
    }
    leaving = null;
    arriving = null;
    dragging = false;
    settling = false;
  };

  /**
   * Clip the top panel back from whichever edge the finger is heading towards, uncovering the one
   * underneath. Taking the edge from the current sign rather than the starting one means reversing
   * mid-drag just works: at the moment the sign flips the clip is zero either way, so nothing
   * visible jumps.
   */
  const clip = (dx: number): void => {
    if (!leaving) {
      return;
    }
    const amount = Math.min(Math.abs(dx), stage.clientWidth);
    leaving.style.clipPath =
      dx < 0 ? `inset(0 ${amount}px 0 0)` : `inset(0 0 0 ${amount}px)`;
  };

  stage.addEventListener('pointerdown', (event) => {
    // Ignore a second finger, and anything landing mid-hand-over.
    if (pointer !== null || settling) {
      return;
    }
    pointer = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
  });

  stage.addEventListener('pointermove', (event) => {
    if (pointer !== event.pointerId) {
      return;
    }
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    if (!dragging) {
      if (Math.abs(dx) < DRAG_SLOP || Math.abs(dx) <= Math.abs(dy) * DRAG_BIAS) {
        return;
      }
      dragging = true;
      const target = handlers.peek();
      if (target !== null) {
        arriving = target === 'photo' ? photo : study;
        leaving = target === 'photo' ? study : photo;
        leaving.classList.add('panel--over');
        arriving.classList.add('panel--under');
        stage.classList.add('stage--dragging');
      }
    }

    clip(dx);
  });

  const release = (event: PointerEvent): void => {
    if (pointer !== event.pointerId) {
      return;
    }
    pointer = null;

    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    if (!dragging) {
      if (Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) {
        handlers.tap();
      }
      clear();
      return;
    }

    const committed = Math.abs(dx) >= stage.clientWidth * COMMIT_FRACTION;

    if (!leaving || !arriving) {
      clear();
      if (committed) {
        handlers.commit();
      }
      return;
    }

    // Finish uncovering, or close back over, before handing over. The hand-over happens at the end
    // so the arriving panel is already fully visible when the view changes, and nothing flashes.
    settling = true;
    stage.classList.add('stage--settling');
    clip(committed ? (dx < 0 ? -stage.clientWidth : stage.clientWidth) : 0);

    window.setTimeout(() => {
      if (committed) {
        handlers.commit();
      }
      clear();
    }, SETTLE_MS);
  };

  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', (event) => {
    if (pointer === event.pointerId) {
      pointer = null;
      clear();
    }
  });
}
