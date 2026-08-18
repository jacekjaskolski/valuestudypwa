/**
 * Which tool sheet is open.
 *
 * One at a time: opening a tool closes whatever was open, and tapping the open tool again closes
 * it. The sheet is *not* modal — the value bar and the tool switcher stay live underneath it,
 * because adjusting the boundaries while a tool is open is a normal thing to want.
 *
 * That non-modality is why an outside tap does not dismiss it: the nearest thing outside the
 * sheet is the value bar, and dragging a boundary must not close the panel you were reading. The
 * ways out are the same tool again, another tool, Escape, or a tap on the image — the last being
 * a plain "get out of the way" that costs nothing to discover and nothing to undo. The tap is
 * recognised in `gestures.ts`, which is also where a swipe is, so that flicking between the photo
 * and the study does not count as a tap and close the sheet.
 */

import { requireElement } from './canvas';

export interface Sheets {
  /** Close whatever is open. */
  close: () => void;
}

export function bindSheets(): Sheets {
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.tool[data-sheet]'),
  );

  let openId: string | null = null;

  const sheetFor = (id: string): HTMLElement => requireElement(id, HTMLElement);

  const buttonFor = (id: string): HTMLButtonElement | undefined =>
    buttons.find((button) => button.dataset['sheet'] === id);

  /**
   * `moveFocus` is on when the sheet was opened deliberately, so that a keyboard user lands in the
   * controls they just asked for. The sheets sit before the toolbar in the document, so without
   * it the only way to reach them is backwards.
   */
  const show = (id: string | null, moveFocus: boolean): void => {
    for (const button of buttons) {
      const target = button.dataset['sheet'];
      if (target === undefined) {
        continue;
      }
      const isOpen = target === id;
      button.setAttribute('aria-expanded', String(isOpen));
      sheetFor(target).hidden = !isOpen;
    }
    openId = id;
    if (id !== null && moveFocus) {
      sheetFor(id).focus();
    }
  };

  const close = (returnFocus: boolean): void => {
    const previous = openId;
    if (previous === null) {
      return;
    }
    show(null, false);
    if (returnFocus) {
      buttonFor(previous)?.focus();
    }
  };

  for (const button of buttons) {
    button.addEventListener('click', () => {
      const target = button.dataset['sheet'];
      if (target === undefined) {
        return;
      }
      if (openId === target) {
        close(true);
      } else {
        show(target, true);
      }
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && openId !== null) {
      event.preventDefault();
      close(true);
    }
  });

  show(null, false);

  return { close: () => close(false) };
}
