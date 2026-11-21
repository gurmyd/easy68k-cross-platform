// Cut, Copy, Paste and Select All from the menu, the toolbar and the context menu (editor-ui §8.7;
// ARCHITECTURE.md 1.4 note 45). Owner: E2.
//
// The keyboard chords never come here: the dispatcher leaves Ctrl/Cmd+X, C, V, A and Shift+Insert
// to the focused element, where the browser fires its own clipboard events (errata/W3.md entry 1)
// and CodeMirror takes plain text from them. This module serves the mouse:
//
//   - the commands act on "whichever text control has focus" (§8.7): the editor, or a text field
//     such as the Find box. A toolbar button or a menu may hold the focus at that moment, so the
//     target is the focused text control, else the one that had the focus last, else the active
//     document's editor;
//   - Cut and Copy use the browser's `execCommand`, which is allowed during a click;
//   - Paste (note 45): the desktop app pastes natively (`Platform.pasteIntoFocus`). A browser has no
//     key event to ride on, so the page asks for the clipboard (`navigator.clipboard.readText`):
//     Chromium asks for permission once, Safari shows a small `Paste` confirmation each time. If the
//     browser refuses, a toast says `Press Ctrl+V to paste` (`Cmd+V` on macOS).

import type { EditorView } from '@codemirror/view';
import { normalizeLineBreaks } from './editing';

/** A text field outside the editor (input or textarea). */
export interface TextFieldLike {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  focus(): void;
  select(): void;
  setRangeText(
    replacement: string,
    start: number,
    end: number,
    selectionMode?: 'select' | 'start' | 'end' | 'preserve',
  ): void;
  dispatchEvent(event: Event): boolean;
}

/** Where a clipboard command goes. */
export type ClipboardTarget = { kind: 'editor'; view: EditorView } | { kind: 'field'; field: TextFieldLike } | null;

/** What the clipboard commands need from the page; tests pass fakes. */
export interface ClipboardEnv {
  /** `document.execCommand` (cut / copy); false when the browser refused. */
  execCommand(command: 'cut' | 'copy'): boolean;
  /** `navigator.clipboard.readText`, or null where the page has no Clipboard API. */
  readText: (() => Promise<string>) | null;
  /** `navigator.clipboard.writeText`, or null. */
  writeText: ((text: string) => Promise<void>) | null;
  /** `Platform.pasteIntoFocus` (desktop app), null in a browser. */
  pasteIntoFocus: (() => void) | null;
  /** Shows a toast. */
  toast(text: string): void;
  os: 'mac' | 'windows' | 'linux';
}

export function pasteRefusedText(os: ClipboardEnv['os']): string {
  return os === 'mac' ? 'Press Cmd+V to paste' : 'Press Ctrl+V to paste';
}

function focusTarget(target: NonNullable<ClipboardTarget>): void {
  if (target.kind === 'editor') target.view.focus();
  else target.field.focus();
}

export function targetHasSelection(target: ClipboardTarget): boolean {
  if (!target) return false;
  if (target.kind === 'editor') return !target.view.state.selection.main.empty;
  const { selectionStart, selectionEnd } = target.field;
  return selectionStart !== null && selectionEnd !== null && selectionEnd > selectionStart;
}

function selectedText(target: NonNullable<ClipboardTarget>): string {
  if (target.kind === 'editor') {
    const { from, to } = target.view.state.selection.main;
    return target.view.state.sliceDoc(from, to);
  }
  const { value, selectionStart, selectionEnd } = target.field;
  return value.slice(selectionStart ?? 0, selectionEnd ?? 0);
}

function deleteSelection(target: NonNullable<ClipboardTarget>): void {
  if (target.kind === 'editor') {
    target.view.dispatch(target.view.state.replaceSelection(''), { userEvent: 'delete.cut' });
    return;
  }
  const { selectionStart, selectionEnd } = target.field;
  target.field.setRangeText('', selectionStart ?? 0, selectionEnd ?? 0, 'end');
  target.field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Insert `text` as typed-over plain text, replacing the selection; the caret ends after it. */
export function insertPlainText(target: NonNullable<ClipboardTarget>, raw: string): void {
  const text = normalizeLineBreaks(raw);
  if (target.kind === 'editor') {
    const { view } = target;
    view.dispatch(view.state.replaceSelection(text), { userEvent: 'input.paste', scrollIntoView: true });
    return;
  }
  const { selectionStart, selectionEnd } = target.field;
  target.field.setRangeText(text, selectionStart ?? 0, selectionEnd ?? 0, 'end');
  target.field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Cut or Copy on the target. Falls back to the Clipboard API when execCommand is refused. */
export async function cutOrCopy(target: ClipboardTarget, command: 'cut' | 'copy', env: ClipboardEnv): Promise<void> {
  if (!target || !targetHasSelection(target)) return;
  focusTarget(target);
  if (env.execCommand(command)) return;
  if (!env.writeText) return;
  const text = selectedText(target);
  try {
    await env.writeText(text);
  } catch {
    return;
  }
  if (command === 'cut') deleteSelection(target);
}

/** Paste from a menu, the toolbar or the context menu (note 45). */
export async function pasteFromMenu(target: ClipboardTarget, env: ClipboardEnv): Promise<void> {
  if (!target) return;
  focusTarget(target);
  if (env.pasteIntoFocus) {
    env.pasteIntoFocus();
    return;
  }
  if (!env.readText) {
    env.toast(pasteRefusedText(env.os));
    return;
  }
  let text: string;
  try {
    text = await env.readText();
  } catch {
    env.toast(pasteRefusedText(env.os));
    return;
  }
  // Does nothing unless the clipboard holds text (editor-ui §8.7).
  if (text.length === 0) return;
  insertPlainText(target, text);
}

/** Select All on the target. */
export function selectAllIn(target: ClipboardTarget): void {
  if (!target) return;
  focusTarget(target);
  if (target.kind === 'editor') {
    const { view } = target;
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length }, userEvent: 'select' });
  } else {
    target.field.select();
  }
}
