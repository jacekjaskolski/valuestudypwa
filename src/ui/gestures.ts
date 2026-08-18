/**
 * Pointer gestures on the image.
 *
 * A horizontal drag pulls the other image in behind the finger and hands over when released, so
 * comparing the photo against the study is a flick rather than a trip to a control. The switch is
 * still there for a deliberate change; this is for the quick back-and-forth that comparing is.
 *
 * Tap and drag are recognised here together rather than in two listeners, because they are the
 * same gesture until the finger lifts. Deciding separately is how a swipe ends up also counting as
 * a tap, which would dismiss the open sheet every time the view was flicked.
 */

/** How far a finger must travel horizontally before it is a drag rather than a press. */
const DRAG_SLOP = 12;

/** How much more horizontal than vertical the travel must be, so a diagonal is not a swipe. */
const DRAG_BIAS = 1.2;

/** Past this, releasing hands over to the other image; short of it, it springs back. */
const COMMIT_DISTANCE = 60;

/** Anything that moves less than this is a tap, however long the finger rests. */
const TAP_SLOP = 10;

/** Long enough to read as a hand-over, short enough not to be waited on. Matches the CSS. */
const SETTLE_MS = 170;

export interface StageGestureHandlers {
  /**
   * Which view a drag in this direction would reach, or `null` to move without previewing.
   * Previewing needs one image leaving and one arriving; the side-by-side view is neither.
   */
  peek: (direction: 1 | -1) => 'photo' | 'study' | null;
  commit: (direction: 1 | -1) => void;
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
  /** The panel on screen, and the one being pulled in behind it. Null when not previewing. */
  let leaving: HTMLElement | null = null;
  let arriving: HTMLElement | null = null;
  let settling = false;

  const clear = (): void => {
    stage.classList.remove('stage--dragging', 'stage--settling');
    photo.style.transform = '';
    study.style.transform = '';
    leaving = null;
    arriving = null;
    dragging = false;
    settling = false;
  };

  const place = (dx: number): void => {
    if (!leaving || !arriving) {
      return;
    }
    const width = stage.clientWidth;
    leaving.style.transform = `translateX(${dx}px)`;
    // The arriving panel sits one screen away on whichever side the finger came from. Deriving the
    // side from the current sign rather than the starting one means reversing mid-drag just works:
    // at the moment the sign flips it is a full screen away either way, so nothing visible jumps.
    arriving.style.transform = `translateX(${dx + (dx < 0 ? width : -width)}px)`;
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
      const target = handlers.peek(dx < 0 ? 1 : -1);
      if (target !== null) {
        arriving = target === 'photo' ? photo : study;
        leaving = target === 'photo' ? study : photo;
        stage.classList.add('stage--dragging');
      }
    }

    place(dx);
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

    const direction: 1 | -1 = dx < 0 ? 1 : -1;
    const committed = Math.abs(dx) >= COMMIT_DISTANCE;

    if (!leaving || !arriving) {
      clear();
      if (committed) {
        handlers.commit(direction);
      }
      return;
    }

    // Run the panels the rest of the way, or back where they came from, before handing over. The
    // hand-over happens at the end so the arriving panel is already in place when the view
    // changes, and nothing flashes.
    const width = stage.clientWidth;
    settling = true;
    stage.classList.add('stage--settling');
    leaving.style.transform = `translateX(${committed ? (dx < 0 ? -width : width) : 0}px)`;
    arriving.style.transform = committed
      ? 'translateX(0px)'
      : `translateX(${dx < 0 ? width : -width}px)`;

    window.setTimeout(() => {
      if (committed) {
        handlers.commit(direction);
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
