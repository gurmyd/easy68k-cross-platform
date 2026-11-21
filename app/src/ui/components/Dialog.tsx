// Dialog (ARCHITECTURE.md 2.7, 2.11). Owner: W2.
//
// An in-window layer with a title bar. Every dialog of the port is built
// from it; the shell's dialog host (W3) decides where it is mounted.
//
// Modal (default): dims the workspace (backdrop at --z-modal), role=dialog
// with aria-modal, focus trapped inside: the dialog moves the focus on every
// Tab and Shift+Tab itself (its own list, wrapping at the ends; Safari would
// skip buttons), Tab with the focus outside (on the body) brings it back in,
// and focus that escapes (a click elsewhere, a programmatic focus) is pulled back. Only
// the top-most modal dialog traps; a message box over a dialog works.
// Modeless: floats at `anchor` above the workspace (--z-modeless) and does
// not block it.
//
// Both: the focus goes in when the dialog opens (initialFocus, else an element
// with data-autofocus, else the default button, else the first field) and
// back to where it was when it closes. Escape calls onCancel. Enter presses
// the default button (a Button with isDefault) unless the focused control
// uses Enter itself (buttons, multi-line text, lists that set
// data-e68-enter). Access keys: Alt (Option) + letter, or the letter alone
// while the focus is not in a text field, presses the button or toggles the
// check box whose caption has that '&' letter, or focuses that text field.
// Modal dialogs answer Escape, Enter and the access keys also while the focus
// is on the body (the focused control was disabled, hidden or removed).

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import './Dialog.css';
import {
  countPreceding,
  focusElement,
  focusOrigin,
  holdsFocus,
  indexHolding,
  isDialogBodyKey,
  isImeKey,
  pushModal,
  removeModal,
  restoreOrder,
  tabbables,
  topModal,
  trackPressedControls,
  trapOrder,
} from './focus';
import { IconButton } from './IconButton';
import { LayerContext } from './layer';
import { mnemonicKeyOf } from './mnemonic';

export interface DialogAnchor {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface DialogProps {
  /** Title bar text, verbatim from the original ('Assembler Status - prog.X68'). */
  title: string;
  children: ReactNode;
  /** The button row. */
  footer?: ReactNode;
  /** Default true. */
  modal?: boolean;
  /** Escape and the title bar's close button. Without it the dialog has no close button and Escape does nothing. */
  onCancel?: () => void;
  initialFocus?: RefObject<HTMLElement | null>;
  /** 'alertdialog' for message boxes. */
  role?: 'dialog' | 'alertdialog';
  /** Id of the element that describes the dialog (a message box's text). */
  describedBy?: string;
  /** Modeless dialogs: distance from the viewport edges, in px. Default: top right of the workspace. */
  anchor?: DialogAnchor;
  /** Width of the box (CSS length or px). */
  width?: number | string;
  /** Render in place without layer, trap or focus moves: the gallery's previews. */
  inline?: boolean;
  className?: string;
}

// Remember pressed controls from the start, so the first dialog opened by a
// click in Safari can give the focus back (focus.ts focusOrigin).
if (typeof document !== 'undefined') trackPressedControls();

const TEXT_ENTRY =
  'input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, select, [contenteditable="true"], [role=listbox], [role=grid], [role=combobox]';
const OWNS_ENTER =
  'button, a[href], textarea, select, [data-e68-enter], [role=listbox], [role=grid], [role=menu], [role=menuitem]';

/** Where the focus was last inside a modal dialog: the element and its index in the dialog's list then. */
interface LastInside {
  element: HTMLElement | null;
  index: number;
}

/**
 * How many elements of `list` come before the place of a control that lost
 * the focus: `from` (where the focus is now) when it is inside the dialog or
 * the lost control is unknown or still in the list; else the lost control
 * when it is still in the dialog (disabled or hidden); else (removed) the
 * index it had.
 */
function precedingLost(box: HTMLElement, list: HTMLElement[], from: Node, last: LastInside): number {
  const gone = last.element;
  if (box.contains(from) || !gone || list.includes(gone)) return countPreceding(list, from);
  if (gone.isConnected && box.contains(gone)) return countPreceding(list, gone);
  return Math.min(Math.max(0, last.index), list.length);
}

/** Focuses the elements of `list` at `order`, one after the other, until one holds the focus. */
function focusFirstTaker(list: HTMLElement[], order: number[]): boolean {
  for (const index of order) {
    const candidate = list[index];
    focusElement(candidate);
    // A control that hands its focus to a child has taken it too (holdsFocus).
    if (holdsFocus(candidate, document.activeElement)) return true;
  }
  return false;
}

/**
 * Tab and Shift+Tab in a modal dialog: always to the next or previous element
 * of the dialog's own list, wrapping at the ends. Not left to the browser,
 * because Safari (macOS default setting) skips buttons and check boxes and
 * would leave the dialog (docs/porting/errata/W2.md entry 13). An element
 * that refuses the focus is passed over (`trapOrder`). When the focus is
 * outside the dialog because the control that had it was disabled, hidden or
 * removed, Tab goes on from where that control was. A child that took the
 * focus from its container counts as that container (`indexHolding`).
 */
function moveTab(box: HTMLElement, from: Node, backward: boolean, last: LastInside): void {
  const list = tabbables(box);
  const current = box.contains(from) ? indexHolding(list, from) : -1;
  const preceding = current < 0 ? precedingLost(box, list, from, last) : 0;
  if (focusFirstTaker(list, trapOrder(list.length, current, backward, preceding))) return;
  if (list.length === 0) focusElement(box);
}

/**
 * Focus landed outside the top-most modal dialog: give it back to the control
 * that had it; if that one refuses it (disabled or hidden meanwhile) or is
 * gone, to its next neighbour, else to the first control, else to the box.
 */
function restoreFocus(box: HTMLElement, last: LastInside): void {
  const element = last.element;
  if (element?.isConnected && box.contains(element)) focusElement(element);
  if (box.contains(document.activeElement)) return;
  const list = tabbables(box);
  let preceding = 0;
  if (element?.isConnected && box.contains(element)) preceding = countPreceding(list, element);
  else if (element) preceding = Math.min(Math.max(0, last.index), list.length);
  if (focusFirstTaker(list, restoreOrder(list.length, preceding))) return;
  focusElement(box);
}

/** The parts of a key event the dialog's key handling reads (a React event or a DOM one). */
interface DialogKey {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

export function Dialog({
  title,
  children,
  footer,
  modal = true,
  onCancel,
  initialFocus,
  role = 'dialog',
  describedBy,
  anchor = { top: 72, right: 24 },
  width,
  inline = false,
  className,
}: DialogProps) {
  const titleId = useId();
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const lastInside = useRef<LastInside>({ element: null, index: -1 });

  // Focus in on open, back out on close.
  useLayoutEffect(() => {
    const box = ref.current;
    if (inline || !box) return;
    const before = focusOrigin();
    if (modal) pushModal(box);
    const target =
      initialFocus?.current ??
      box.querySelector<HTMLElement>('[data-autofocus]') ??
      box.querySelector<HTMLElement>('[data-e68-default]:not(:disabled)') ??
      tabbables(box)[0] ??
      box;
    focusElement(target);
    return () => {
      if (modal) removeModal(box);
      // Give the focus back only if it is still inside (or nowhere): a modeless
      // dialog closed by a click elsewhere leaves the focus where the click put it.
      const active = document.activeElement;
      if (!active || active === document.body || box.contains(active)) {
        if (before && before !== document.body) focusElement(before);
      }
    };
    // Mount and unmount only.
  }, []);

  // Escape, Enter and the access keys: one handler for keys inside the box and for those that
  // reach the document while the focus is on the body (followups item 3). Kept in a ref so the
  // document listener below always calls the current one (onCancel may change).
  const handleKey = (event: DialogKey, target: HTMLElement): void => {
    const box = ref.current;
    if (!box) return;
    if (event.key === 'Escape') {
      if (onCancel) {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
      return;
    }
    if (event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      if (target !== box && target.closest(OWNS_ENTER)) return;
      const button = box.querySelector<HTMLButtonElement>('[data-e68-default]:not(:disabled)');
      if (button) {
        event.preventDefault();
        button.click();
      }
      return;
    }
    // Access keys.
    if (event.ctrlKey || event.metaKey) return;
    if (!event.altKey && target !== box && target.closest(TEXT_ENTRY)) return;
    const key = mnemonicKeyOf(event);
    if (!key) return;
    const match = Array.from(box.querySelectorAll<HTMLElement>(`[data-e68-mnemonic="${CSS.escape(key)}"]`)).find(
      (candidate) => !(candidate as HTMLButtonElement).disabled && candidate.getClientRects().length > 0,
    );
    if (!match) return;
    event.preventDefault();
    focusElement(match);
    if (match instanceof HTMLButtonElement) match.click();
    else if (match instanceof HTMLInputElement && (match.type === 'checkbox' || match.type === 'radio')) match.click();
    else if (match instanceof HTMLInputElement) match.select();
  };
  const handleKeyRef = useRef(handleKey);
  handleKeyRef.current = handleKey;

  // The trap: focus that lands outside the top-most modal dialog is pulled back.
  useEffect(() => {
    const box = ref.current;
    if (inline || !modal || !box) return;
    const onFocusIn = (event: FocusEvent) => {
      if (topModal() !== box) return;
      const target = event.target as Node | null;
      if (target && box.contains(target)) {
        lastInside.current = { element: target as HTMLElement, index: indexHolding(tabbables(box), target) };
        return;
      }
      // Back to the last control inside, or, if that one refuses the focus now, its neighbour.
      restoreFocus(box, lastInside.current);
    };
    // Keys while the focus is outside (on the body, which gets no focusin): Tab brings the focus
    // back into the dialog; Escape, Enter and the access keys work as inside (followups item 3).
    // Inside, the box's own key handler takes them.
    const onKeyDownOutside = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || isImeKey(event)) return;
      if (topModal() !== box) return;
      const target = event.target as Node | null;
      if (target && box.contains(target)) return;
      if (event.key === 'Tab') {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        event.preventDefault();
        moveTab(box, target ?? document.body, event.shiftKey, lastInside.current);
        return;
      }
      const onBody = !target || target === document.body || target === document.documentElement;
      if (onBody && isDialogBodyKey(event)) handleKeyRef.current(event, box);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('keydown', onKeyDownOutside);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('keydown', onKeyDownOutside);
    };
  }, [inline, modal]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const box = ref.current;
    if (!box || inline || event.defaultPrevented) return;
    if (modal && topModal() !== box) return;
    const target = event.target as HTMLElement;

    if (event.key === 'Tab' && modal) {
      // Ctrl / Cmd / Alt (Option) + Tab stay with the browser and the shell.
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      // A Tab that an input method (IME) is composing with belongs to the IME.
      if (isImeKey(event.nativeEvent)) return;
      event.preventDefault();
      moveTab(box, target, event.shiftKey, lastInside.current);
      return;
    }
    handleKey(event, target);
  };

  const style: CSSProperties = {};
  if (width !== undefined) style.width = width;
  if (!modal && !inline) Object.assign(style, anchor);

  const box = (
    <div
      ref={(node) => {
        ref.current = node;
        setElement(node);
      }}
      role={role}
      aria-modal={modal && !inline ? true : undefined}
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      tabIndex={-1}
      className={[
        'e68-dialog',
        modal ? 'e68-dialog--modal' : 'e68-dialog--modeless',
        inline ? 'e68-dialog--inline' : '',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      onKeyDown={onKeyDown}
    >
      <div className="e68-dialog__titlebar">
        <h2 id={titleId} className="e68-dialog__title">
          {title}
        </h2>
        {onCancel && (
          <IconButton
            className="e68-dialog__close"
            icon="close"
            label="Close"
            size="small"
            tooltip={false}
            tabIndex={-1}
            onClick={onCancel}
          />
        )}
      </div>
      <LayerContext.Provider value={element}>
        <div className="e68-dialog__body">{children}</div>
        {footer && <div className="e68-dialog__footer">{footer}</div>}
      </LayerContext.Provider>
    </div>
  );

  if (inline || !modal) return box;
  return (
    <div
      className="e68-dialog__backdrop"
      onMouseDown={(event) => {
        // A press beside a modal dialog does nothing; the focus stays inside.
        if (event.target === event.currentTarget) event.preventDefault();
      }}
    >
      {box}
    </div>
  );
}
