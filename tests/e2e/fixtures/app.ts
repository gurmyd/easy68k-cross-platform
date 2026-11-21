// The page object of the end-to-end suites (ARCHITECTURE.md 6.6). Owner: X1.
//
// Everything here works on the PRODUCTION build: there is no `window.__easy68k` page object, so the
// tests act through the interface (menus, toolbar, keys, dialogs, the Files panel, drag and drop)
// and read what a user sees (tabs, status bar, dialogs, the editor's text). Two readings go below
// the surface, both read-only or limited to what a user could equally do by hand:
//
//   - the editor's text and selection come from the CodeMirror view of the document's element,
//     found the way `EditorView.findFromDOM` of the pinned @codemirror/view finds it (tab
//     characters are drawn by a widget, so the DOM text does not contain them);
//   - `select()` puts the caret or a selection at character offsets, as a mouse drag would.
//
// Bytes in storage are read back with the Files panel's Export... (a download) and written with its
// Import... (a file chooser) or by dropping files, as a student does.

import type { Download, Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { EDITOR_MENUS } from '../../../app/src/commands/tables/editor-menu';
import { COMMAND_SPECS } from '../../../app/src/commands/specs';
import type { KnownCommandId } from '../../../app/src/commands/ids';
import type { MenuNode } from '../../../app/src/commands/tables/types';
import { chordOf, chordsOf, modKey, playwrightKey, type KeyMap } from './keys';
import type { ProbeHost } from './pending';

/** A file for Import... or a drop: its name and its bytes (a string is taken as Latin-1 bytes). */
export interface FileSpec {
  name: string;
  data: string | Uint8Array;
}

/** One entry of an open menu as a user sees it. */
export interface MenuEntry {
  role: string;
  caption: string;
  shortcut: string;
  disabled: boolean;
  checked: boolean | null;
}

/** One document tab. */
export interface TabInfo {
  name: string;
  selected: boolean;
  title: string;
  modified: boolean;
}

/** The bytes of a string whose characters are all below U+0100 (Latin-1 / the test's raw bytes). */
export function bytesOf(data: string | Uint8Array): Uint8Array {
  if (typeof data !== 'string') return data;
  const bytes = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const code = data.charCodeAt(i);
    if (code > 0xff) throw new Error(`bytesOf: character U+${code.toString(16)} is not a byte`);
    bytes[i] = code;
  }
  return bytes;
}

/** The text of bytes, one character per byte (for comparing file contents in messages). */
export function latin1(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

/** Lines joined with CR LF, with a final CR LF (the files the original writes). */
export function crlf(...lines: string[]): string {
  return lines.map((line) => `${line}\r\n`).join('');
}

/** The caption of a menu entry as drawn: the specification's caption without the `&` marks. */
export function plainCaption(caption: string): string {
  return caption.replace(/&(.)/g, '$1');
}

/** The menu (by its plain title) whose table holds a command, for the Editor's menu bar. */
export function editorMenuOf(id: string): string | null {
  const holds = (items: MenuNode[]): boolean =>
    items.some((node) => (node.type === 'command' && node.id === id) || (node.type === 'submenu' && holds(node.items)));
  const menu = EDITOR_MENUS.find((table) => holds(table.items));
  return menu ? plainCaption(menu.caption) : null;
}

export class App implements ProbeHost {
  /** Console errors and uncaught exceptions of the page; the fixture fails a test that has any. */
  readonly errors: string[] = [];

  /** Every window of this browser profile opened through openWindow, this one included. */
  readonly family: App[];

  constructor(
    readonly page: Page,
    readonly keys: KeyMap,
    family?: App[],
  ) {
    this.family = family ?? [];
    this.family.push(this);
    page.on('console', (message) => {
      if (message.type() === 'error') this.errors.push(message.text());
    });
    page.on('pageerror', (error) => this.errors.push(String(error)));
  }

  // ---- start ---------------------------------------------------------------------------------

  /** Loads the application (optionally with a query such as `?open=...`) and waits for the shell. */
  async open(query = ''): Promise<void> {
    await this.page.goto(query ? `./${query}` : './');
    await this.ready();
  }

  /** Waits until the shell is drawn and, in Editor mode, the editor of the active document. */
  async ready(): Promise<void> {
    // The first load of a page parses about 1 MB of script: generous on a loaded machine.
    await this.shell.waitFor({ timeout: 60_000 });
    if ((await this.mode()) === 'editor') {
      await this.page.locator('.e68-editor').first().waitFor({ timeout: 60_000 });
    }
  }

  get shell(): Locator {
    return this.page.locator('.e68-shell');
  }

  async mode(): Promise<string | null> {
    return this.shell.getAttribute('data-mode');
  }

  /** The key map the application chose (`windows` or `mac`), from the shell's data-os. */
  async os(): Promise<string | null> {
    return this.shell.getAttribute('data-os');
  }

  // ---- keys ----------------------------------------------------------------------------------

  /** Presses a chord of the table's normal form (`Ctrl+Alt+Z`, `Shift+Cmd+S`, `F9`). */
  async pressChord(chord: string): Promise<void> {
    await this.page.keyboard.press(playwrightKey(chord));
  }

  /** Presses the `index`-th chord the application gives a command on this key map. */
  async press(id: KnownCommandId, index = 0): Promise<void> {
    const chord = index === 0 ? chordOf(id, this.keys) : chordsOf(id, this.keys)[index];
    if (!chord) throw new Error(`${id} has no chord number ${index} on the ${this.keys} key map`);
    await this.pressChord(chord);
  }

  /** Every chord of a command on this key map. */
  chords(id: KnownCommandId): string[] {
    return chordsOf(id, this.keys);
  }

  /** The system's Mod key (Cmd on a Mac, Ctrl elsewhere), for the editor's own keys. */
  get mod(): 'Meta' | 'Control' {
    return modKey(this.keys);
  }

  // ---- menus and toolbar ---------------------------------------------------------------------

  menuTitle(title: string): Locator {
    return this.page.locator('.e68-shell__menubar .e68-menubar__title').filter({ hasText: new RegExp(`^${title}$`) });
  }

  /** The open drop-down menu. */
  get openMenuList(): Locator {
    return this.page.locator('[role=menu][data-e68-menu]').last();
  }

  /** Opens a menu of the menu bar by its title (`File`, `Edit`, ...). */
  async openMenu(title: string): Promise<Locator> {
    await this.menuTitle(title).click();
    await this.openMenuList.waitFor();
    return this.openMenuList;
  }

  /** Reads the entries of the open menu. */
  async entriesOf(menu: Locator): Promise<MenuEntry[]> {
    return menu.locator(':scope > [role^=menuitem]').evaluateAll((items) =>
      items.map((item) => {
        const checked = item.getAttribute('aria-checked');
        return {
          role: item.getAttribute('role') ?? '',
          caption: item.querySelector('.e68-menu__caption')?.textContent ?? '',
          shortcut: item.querySelector('.e68-menu__shortcut')?.textContent ?? '',
          disabled: item.getAttribute('aria-disabled') === 'true',
          checked: checked === null ? null : checked === 'true',
        };
      }),
    );
  }

  /** The entries of a menu of the menu bar; the menu is closed again afterwards. */
  async menuEntries(title: string): Promise<MenuEntry[]> {
    const menu = await this.openMenu(title);
    const entries = await this.entriesOf(menu);
    await this.page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    return entries;
  }

  /** An entry of the open menu by its caption as drawn. */
  menuItem(menu: Locator, caption: string): Locator {
    return menu
      .locator(':scope > [role^=menuitem]')
      .filter({ has: this.page.locator('.e68-menu__caption', { hasText: new RegExp(`^${escapeRegExp(caption)}$`) }) });
  }

  /** Chooses `caption` in the menu `title`. */
  async chooseMenu(title: string, caption: string): Promise<void> {
    const menu = await this.openMenu(title);
    await this.menuItem(menu, caption).click();
  }

  /** The button of a command in the mode's toolbar. */
  toolbarButton(id: string): Locator {
    return this.page.locator(`.e68-shell__toolbar [data-command="${id}"]`);
  }

  /** Whether a command is enabled: its toolbar button, or else its entry in the Editor's menus. */
  async commandEnabled(id: string): Promise<boolean> {
    const button = this.toolbarButton(id);
    if ((await button.count()) > 0) return button.isEnabled();
    const title = editorMenuOf(id);
    const spec = COMMAND_SPECS[id as KnownCommandId];
    if (!title || !spec) throw new Error(`commandEnabled: no toolbar button or Editor menu entry for ${id}`);
    const caption = plainCaption(spec.caption);
    const entry = (await this.menuEntries(title)).find((e) => e.caption === caption);
    return entry !== undefined && !entry.disabled;
  }

  // ---- dialogs -------------------------------------------------------------------------------

  /** The message box on top (a modal `alertdialog`). */
  get messageBox(): Locator {
    return this.page.locator('[role=alertdialog]').last();
  }

  /** A dialog by its exact title. */
  dialog(title: string): Locator {
    return this.page
      .locator('[role=dialog], [role=alertdialog]')
      .filter({ has: this.page.locator('.e68-dialog__title', { hasText: new RegExp(`^${escapeRegExp(title)}$`) }) });
  }

  /**
   * A button of a dialog by its caption as drawn (mnemonic marks are not part of the text). The
   * kit's title-bar X (`.e68-dialog__close`) is named `Close` as well; it is never meant here, so
   * `button(dialog, 'Close')` finds the dialog's own Close button. The X has `titleBarClose()`.
   */
  button(scope: Locator, caption: string): Locator {
    return scope.getByRole('button', { name: caption, exact: true }).and(this.page.locator(':not(.e68-dialog__close)'));
  }

  /** The title-bar X of a dialog (the kit's `.e68-dialog__close`). */
  titleBarClose(scope: Locator): Locator {
    return scope.locator('.e68-dialog__close');
  }

  /** The text of a message box with runs of white space kept (captions are verbatim, white-space: pre). */
  async boxText(box: Locator = this.messageBox): Promise<string> {
    return box.locator('.e68-dialog__body').innerText();
  }

  // ---- editor --------------------------------------------------------------------------------

  pane(index = 0): Locator {
    return this.page.locator(`.e68-editor__pane[data-pane="${index}"]`);
  }

  /** The editable content of the document shown in a pane. */
  content(index = 0): Locator {
    return this.pane(index).locator('.cm-content');
  }

  /** Gives the editor of a pane the keyboard focus without moving its caret. */
  async focusEditor(index = 0): Promise<void> {
    await this.content(index).focus();
    await expect(this.content(index)).toBeFocused();
  }

  /** The text of the document shown in a pane, lines separated by "\n" (as DocumentService.text). */
  async text(index = 0): Promise<string> {
    return this.pane(index).evaluate((pane) => viewIn(pane).state.doc.toString());
  }

  /** The main selection of the document shown in a pane, in characters. */
  async selection(index = 0): Promise<{ anchor: number; head: number; from: number; to: number }> {
    return this.pane(index).evaluate((pane) => {
      const range = viewIn(pane).state.selection.main;
      return { anchor: range.anchor, head: range.head, from: range.from, to: range.to };
    });
  }

  /** Puts the caret (or a selection from `anchor` to `head`) into the document of a pane and focuses it. */
  async select(anchor: number, head = anchor, index = 0): Promise<void> {
    await this.pane(index).evaluate(
      (pane, [a, h]) => {
        const view = viewIn(pane);
        view.dispatch({ selection: { anchor: a, head: h }, scrollIntoView: true });
        view.focus();
      },
      [anchor, head] as const,
    );
    await expect(this.content(index)).toBeFocused();
  }

  /**
   * Replaces the whole text of the document in a pane as a user would: Select All, then a paste of
   * plain text (the editor's own paste path). The paste is one undo step.
   */
  async replaceText(text: string, index = 0): Promise<void> {
    await this.focusEditor(index);
    await this.page.keyboard.press(`${this.mod}+KeyA`);
    await this.paste(text, index);
    await expect.poll(() => this.text(index)).toBe(text);
  }

  /** Pastes plain text (and optionally HTML) at the selection, through a real `paste` event. */
  async paste(text: string, index = 0, html?: string): Promise<void> {
    await this.content(index).evaluate(
      (element, [plain, rich]) => {
        const data = new DataTransfer();
        data.setData('text/plain', plain);
        if (rich) data.setData('text/html', rich);
        element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      },
      [text, html ?? ''] as const,
    );
  }

  /** The texts of the status bar cells of a pane: position, Modified, Insert/Replace, empty, info. */
  async status(index = 0): Promise<string[]> {
    return this.pane(index)
      .locator('.e68-editor__cell')
      .evaluateAll((cells) => cells.map((cell) => cell.textContent ?? ''));
  }

  /** The document tabs of a pane. */
  async tabs(index = 0): Promise<TabInfo[]> {
    return this.pane(index)
      .locator('[role=tab]')
      .evaluateAll((tabs) =>
        tabs.map((tab) => ({
          name: tab.querySelector('.e68-tabs__label')?.textContent ?? '',
          selected: tab.getAttribute('aria-selected') === 'true',
          title: tab.getAttribute('title') ?? '',
          modified: tab.getAttribute('data-modified') === 'true' && tab.querySelector('.e68-tabs__dot') !== null,
        })),
      );
  }

  /** The names of the tabs of a pane, in order. */
  async tabNames(index = 0): Promise<string[]> {
    return (await this.tabs(index)).map((tab) => tab.name);
  }

  /** The tab of a document by its name. */
  tab(name: string, index = 0): Locator {
    return this.pane(index)
      .locator('[role=tab]')
      .filter({ has: this.page.locator('.e68-tabs__label', { hasText: new RegExp(`^${escapeRegExp(name)}$`) }) });
  }

  // ---- files ---------------------------------------------------------------------------------

  get filesPanel(): Locator {
    return this.page.locator('[data-e68-panel="files"]');
  }

  /** A row of the Files panel's tree by its name as drawn. */
  treeItem(name: string): Locator {
    return this.filesPanel
      .locator('[role=treeitem]')
      .filter({ has: this.page.locator('.e68-files__name', { hasText: new RegExp(`^${escapeRegExp(name)}$`) }) });
  }

  /** Makes sure the Files panel is shown (Editor mode). */
  async showFiles(): Promise<void> {
    if (!(await this.filesPanel.isVisible())) await this.toolbarButton('app.files.toggle').click();
    await this.filesPanel.waitFor();
  }

  /** Imports files into "My Programs" with the Files panel's Import... > Files or .zip... */
  async importFiles(files: FileSpec[]): Promise<void> {
    await this.showFiles();
    await this.treeItem('My Programs').click();
    await this.filesPanel.getByRole('button', { name: 'Import...' }).click();
    const [chooser] = await Promise.all([
      this.page.waitForEvent('filechooser', { timeout: 60_000 }),
      this.page.getByRole('menuitem', { name: /Files or \.zip/ }).click(),
    ]);
    await chooser.setFiles(
      files.map((file) => ({
        name: file.name,
        mimeType: 'application/octet-stream',
        buffer: Buffer.from(bytesOf(file.data)),
      })),
    );
    for (const file of files) await expect(this.treeItem(file.name)).toBeVisible();
  }

  /** Downloads a file of the Files panel with Export... and returns its bytes. */
  async exportFile(name: string): Promise<Uint8Array> {
    await this.showFiles();
    await this.treeItem(name).click();
    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: 60_000 }),
      this.filesPanel.getByRole('button', { name: 'Export...' }).click(),
    ]);
    return readDownload(download);
  }

  /** Drops files on the editor area, as from the system's file manager (they open as documents). */
  async dropFiles(files: FileSpec[], target = '[data-e68-panel="editor"]'): Promise<void> {
    const payload = files.map((file) => ({ name: file.name, bytes: Array.from(bytesOf(file.data)) }));
    await this.page
      .locator(target)
      .first()
      .evaluate((element, list) => {
        const data = new DataTransfer();
        for (const file of list) data.items.add(new File([new Uint8Array(file.bytes)], file.name));
        element.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }));
        element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
      }, payload);
  }

  /** In an open Save As or Open File dialog: types a name and presses the default button. */
  async fileDialogName(dialog: Locator, name: string, button: 'Save' | 'Open'): Promise<void> {
    const field = dialog.getByLabel('File name:');
    await field.fill(name);
    await this.button(dialog, button).click();
  }

  /**
   * Saves the active document under a new name in My Programs with File > Save As... and waits for
   * the save to finish: the dialog closes before the file is written, and on a slow machine (GitHub's
   * macOS runner) a command sent at once still saw the old name. The save is done when the active
   * tab carries the new name and no longer shows the Modified dot.
   */
  async saveAs(name: string, index = 0): Promise<void> {
    await this.chooseMenu('File', 'Save As...');
    const dialog = this.dialog('Save As');
    await dialog.waitFor();
    await this.fileDialogName(dialog, name, 'Save');
    await expect(dialog).toBeHidden();
    await expect
      .poll(async () => {
        const active = (await this.tabs(index)).find((tab) => tab.selected);
        return active && { name: active.name, modified: active.modified };
      })
      .toEqual({ name, modified: false });
  }

  /** Opens files of My Programs with File > Open File... (the File name field takes one name). */
  async openFile(name: string, filter?: string): Promise<void> {
    await this.chooseMenu('File', 'Open File...');
    const dialog = this.dialog('Open File');
    await dialog.waitFor();
    if (filter) await dialog.getByLabel('Files of type:').selectOption({ label: filter });
    await this.fileDialogName(dialog, name, 'Open');
    await expect(dialog).toBeHidden();
    // The dialog closes before the file is read; wait until its document is the active one, or a
    // test that types next types into the previous document (seen on GitHub's macOS runner).
    await expect.poll(async () => (await this.tabs()).find((tab) => tab.selected)?.name).toBe(name);
  }

  // ---- other windows -------------------------------------------------------------------------

  /**
   * A second window (tab) of the same browser profile, sharing this window's storage. Loading a
   * window costs as much as the test's first one (on a loaded machine, 40 s of 120 s in WebKit), so
   * each extra window adds a minute to the test's time limit; no expectation waits any longer.
   */
  async openWindow(query = ''): Promise<App> {
    test.info().setTimeout(test.info().timeout + EXTRA_WINDOW_TIME);
    const page = await this.page.context().newPage();
    const other = new App(page, this.keys, this.family);
    await other.open(query);
    return other;
  }
}

/** What `App.openWindow` adds to the test's time limit for each extra window, in milliseconds. */
export const EXTRA_WINDOW_TIME = 60_000;

/** Reads a download completely. */
export async function readDownload(download: Download): Promise<Uint8Array> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * The values of every `color` declaration (not `background-color`, `border-color`, ...) in an HTML
 * document's CSS and style attributes that are not black, lower-cased. A monochrome print document
 * (Print w/Black, editor-ui §13) has none.
 */
export function nonBlackColours(html: string): string[] {
  const black = /^(#000|#000000|black|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)|inherit|initial|currentcolor)$/;
  return [...html.matchAll(/(?<![\w-])color\s*:\s*([^;"'}<]+)/gi)]
    .map((match) =>
      match[1]!
        .trim()
        .replace(/\s*!important$/i, '')
        .toLowerCase(),
    )
    .filter((value) => !black.test(value));
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Declared for the page: the CodeMirror view of the document element inside `root`. Defined in
 * the page by the fixture's init script (fixtures/test.ts), because functions passed to
 * `evaluate` cannot share helpers.
 */
declare global {
  function viewIn(root: Element): {
    state: {
      doc: { toString(): string; length: number };
      selection: { main: { anchor: number; head: number; from: number; to: number } };
    };
    dispatch(spec: unknown): void;
    focus(): void;
  };
}
