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
  pushModal,
  removeModal,
  tabbables,
  topModal,
  trackPressedControls,
  trapStep,
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

/**
 * Tab and Shift+Tab in a modal dialog: always to the next or previous element
 * of the dialog's own list, wrapping at the ends. Not left to the browser,
 * because Safari (macOS default setting) skips buttons and check boxes and
 * would leave the dialog (docs/porting/errata/W2.md entry 13).
 */
function moveTab(box: HTMLElement, from: Node, backward: boolean): void {
  const list = tabbables(box);
  const current = list.indexOf(from as HTMLElement);
  const index = trapStep(list.length, current, backward, current < 0 ? countPreceding(list, from) : 0);
  focusElement(index === null ? box : list[index]);
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
  const lastInside = useRef<HTMLElement | null>(null);

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

  // The trap: focus that lands outside the top-most modal dialog is pulled back.
  useEffect(() => {
    const box = ref.current;
    if (inline || !modal || !box) return;
    const onFocusIn = (event: FocusEvent) => {
      if (topModal() !== box) return;
      const target = event.target as Node | null;
      if (target && box.contains(target)) {
        lastInside.current = target as HTMLElement;
        return;
      }
      focusElement(lastInside.current?.isConnected ? lastInside.current : (tabbables(box)[0] ?? box));
    };
    // Tab while the focus is outside (on the body, which gets no focusin): back into the dialog.
    // Inside, the box's own key handler moves the focus.
    const onKeyDownOutside = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (topModal() !== box) return;
      const target = event.target as Node | null;
      if (target && box.contains(target)) return;
      event.preventDefault();
      moveTab(box, target ?? document.body, event.shiftKey);
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
      event.preventDefault();
      moveTab(box, target, event.shiftKey);
      return;
    }
    if (event.key === 'Escape') {
      if (onCancel) {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
      return;
    }
    if (event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      if (target.closest(OWNS_ENTER)) return;
      const button = box.querySelector<HTMLButtonElement>('[data-e68-default]:not(:disabled)');
      if (button) {
        event.preventDefault();
        button.click();
      }
      return;
    }
    // Access keys.
    if (event.ctrlKey || event.metaKey) return;
    if (!event.altKey && target.closest(TEXT_ENTRY)) return;
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
