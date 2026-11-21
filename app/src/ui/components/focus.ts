// Focus helpers: what can take the Tab key, the focus trap of modal dialogs,
// and the stack of open modal dialogs. Owner: W2.

const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]',
].join(',');

/** The elements inside `root` that the Tab key visits, in document order. */
export function tabbables(root: Element): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(TABBABLE));
  return all.filter((element) => {
    if (element.tabIndex < 0) return false;
    if (element.closest('[inert]')) return false;
    // Not rendered (display: none, or inside a closed <details>).
    if (element.getClientRects().length === 0) return false;
    // Of a radio group only the checked button (or the first) is a tab stop.
    if (element instanceof HTMLInputElement && element.type === 'radio' && element.name) {
      const group = all.filter(
        (other): other is HTMLInputElement =>
          other instanceof HTMLInputElement && other.type === 'radio' && other.name === element.name,
      );
      const checked = group.find((radio) => radio.checked);
      return checked ? checked === element : group[0] === element;
    }
    return true;
  });
}

/**
 * The index the focus wraps to when Tab (or Shift+Tab) leaves the ends of a
 * trapped list, or null when the browser's own move stays inside.
 * `current` is -1 when the focus is not on one of the elements.
 */
export function trapIndex(count: number, current: number, shift: boolean): number | null {
  if (count === 0) return null;
  if (current < 0) return shift ? count - 1 : 0;
  if (shift && current === 0) return count - 1;
  if (!shift && current === count - 1) return 0;
  return null;
}

/** The open modal dialogs, the top one last. Only the top one traps the focus. */
const modalStack: HTMLElement[] = [];

export function pushModal(element: HTMLElement): void {
  modalStack.push(element);
}

export function removeModal(element: HTMLElement): void {
  const index = modalStack.lastIndexOf(element);
  if (index >= 0) modalStack.splice(index, 1);
}

export function topModal(): HTMLElement | null {
  return modalStack[modalStack.length - 1] ?? null;
}

/** True while any modal dialog of the kit is open. */
export function isModalOpen(): boolean {
  return modalStack.length > 0;
}

/** Moves the focus without scrolling the page; ignores elements that are gone. */
export function focusElement(element: HTMLElement | null | undefined): void {
  if (element && element.isConnected) element.focus({ preventScroll: true });
}

/**
 * The control the user last pressed with the pointer. Safari does not focus a
 * button when it is clicked, so a dialog opened by a click would otherwise
 * have nowhere to give the focus back to.
 */
let lastPressed: HTMLElement | null = null;
let tracking = false;

const PRESSABLE = 'button, a[href], input, select, textarea, [tabindex]';

/** Starts remembering the last pressed control (idempotent). */
export function trackPressedControls(doc: Document = document): void {
  if (tracking) return;
  tracking = true;
  doc.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(PRESSABLE) : null;
      if (target) lastPressed = target;
    },
    true,
  );
}

/**
 * Where the focus should return when a layer that opens now closes: the
 * focused element, or, when the focus is nowhere (Safari after a click), the
 * control that was just pressed.
 */
export function focusOrigin(doc: Document = document): HTMLElement | null {
  const active = doc.activeElement as HTMLElement | null;
  if (active && active !== doc.body) return active;
  return lastPressed?.isConnected ? lastPressed : null;
}
