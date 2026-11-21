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
    // Disabled, also by a <fieldset disabled> around it (the selectors above miss that case).
    if (element.matches(':disabled')) return false;
    // Not rendered (display: none, or inside a closed <details>).
    if (element.getClientRects().length === 0) return false;
    // Rendered but invisible (visibility: hidden or collapse): it refuses the focus.
    const view = element.ownerDocument.defaultView;
    if (view && view.getComputedStyle(element).visibility !== 'visible') return false;
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
 * Where Tab (or Shift+Tab, `shift`) moves the focus in a modal dialog, which
 * handles every Tab itself (docs/porting/errata/W2.md entry 13): the next (or
 * previous) element of its list, wrapping at the ends; null when the list is
 * empty. `current` is the index of the focused element in the list, or -1
 * when the focus is on none of them; then `preceding` is the number of list
 * elements that come before the focus in document order (0 when the focus is
 * on the dialog itself or outside it, so Tab goes to the first element and
 * Shift+Tab to the last).
 */
export function trapStep(count: number, current: number, shift: boolean, preceding = 0): number | null {
  if (count === 0) return null;
  if (current >= 0 && current < count) return shift ? (current - 1 + count) % count : (current + 1) % count;
  const before = Math.min(Math.max(0, preceding), count);
  if (shift) return before > 0 ? before - 1 : count - 1;
  return before < count ? before : 0;
}

/**
 * The indices of a modal dialog's list to try, in turn, for one Tab (or
 * Shift+Tab): first the one `trapStep` gives, then on in the same direction,
 * each element once. The dialog focuses them one after the other until one
 * takes the focus, so an element that refuses it (removed or hidden in the
 * meantime) does not hold the focus in place.
 */
export function trapOrder(count: number, current: number, shift: boolean, preceding = 0): number[] {
  const first = trapStep(count, current, shift, preceding);
  if (first === null) return [];
  const order: number[] = [];
  for (let i = 0; i < count; i++) order.push(shift ? (((first - i) % count) + count) % count : (first + i) % count);
  return order;
}

/**
 * True for a key pressed while an input method (IME) is composing text: the
 * key belongs to the IME (Tab may pick a candidate), so a dialog leaves it alone.
 * Browsers report such a keydown with `isComposing` or with the key code 229.
 */
export function isImeKey(event: { isComposing?: boolean; keyCode?: number }): boolean {
  return event.isComposing === true || event.keyCode === 229;
}

/** The parts of a DOM node that `indexHolding` and `holdsFocus` use (plain objects in unit tests). */
export interface ContainerLike {
  contains(other: unknown): boolean;
}

/**
 * True when `candidate` has the focus: it is the focused element (`active`)
 * or contains it. A control that hands its focus to a child when it is
 * focused (a `tabindex="0"` container that focuses a `tabindex="-1"` child)
 * has taken the focus too (docs/requests/W2-dialog-focus-followups.md item 1).
 */
export function holdsFocus(candidate: ContainerLike | null | undefined, active: unknown): boolean {
  if (!candidate || active === null || active === undefined) return false;
  return candidate === active || candidate.contains(active);
}

/**
 * The index in `list` (document order) of the element that holds `node`: the
 * element itself, else the innermost element that contains it (the last such
 * one, since an element comes before its descendants in document order); -1
 * when none does. A child that took the focus from its container counts as
 * that container, so Tab and Shift+Tab move on from it.
 */
export function indexHolding<T extends ContainerLike>(list: readonly T[], node: unknown): number {
  const exact = list.indexOf(node as T);
  if (exact >= 0) return exact;
  let found = -1;
  list.forEach((element, index) => {
    if (element.contains(node)) found = index;
  });
  return found;
}

/**
 * The indices of a modal dialog's list to try, in turn, when the focus left
 * the dialog and giving it back to the control that had it failed (that
 * control was disabled, hidden or removed): that control's next neighbour
 * first, then on through the list, wrapping; with `preceding` 0 (no known
 * place) the first control first. `preceding` is the number of list elements
 * before the lost control. Item 2 of docs/requests/W2-dialog-focus-followups.md.
 */
export function restoreOrder(count: number, preceding: number): number[] {
  return trapOrder(count, -1, false, preceding);
}

/**
 * True for a key that a modal dialog answers even when it reaches the
 * document with the focus on the body (the focused control was disabled,
 * hidden or removed): Escape, Enter, and the access keys (a letter or digit,
 * with or without Alt / Option; not with Ctrl or Cmd). Tab has its own path.
 * Item 3 of docs/requests/W2-dialog-focus-followups.md.
 */
export function isDialogBodyKey(event: {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean {
  if (event.key === 'Escape') return true;
  if (event.key === 'Enter') return !event.ctrlKey && !event.metaKey && !event.altKey;
  if (event.ctrlKey || event.metaKey) return false;
  if (/^(Key[A-Z]|Digit\d)$/.test(event.code)) return true;
  return event.key.length === 1 && /^[\x21-\x7e]$/.test(event.key);
}

/** The number of `list` elements (in document order) that come before `node` in the document. */
export function countPreceding(list: readonly Element[], node: Node): number {
  let count = 0;
  for (const element of list) {
    // An element that holds the focus inside it counts as before it (Tab moves on past it).
    if (element !== node && element.contains(node)) return count + 1;
    if (!(node.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING)) break;
    count++;
  }
  return count;
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
