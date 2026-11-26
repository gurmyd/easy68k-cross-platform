# easy68k-cross-platform - the stage of additions ("Plus")

Status: design, version 1. This document is the contract for one stage of work that comes after the
faithful port. It adds a movable panel layout, a better Files panel, an automatic safety net for
files (earlier versions and a trash), and a viewer for files that are not text. It changes nothing
that a 68000 program can observe, no file the application writes, and none of the original's menus,
commands or keys.

How to read it:

- `ARCHITECTURE.md` is "the main document"; `§2.4` means its section 2.4. This document is "Plus";
  `P3.2` means section 3.2 of this document. Paths are relative to the repository root.
- The code is the truth where the main document and the code differ (the errata in
  `docs/porting/errata/`). This document names real files, types and functions as they are on `main`
  at the time of writing; a package that finds one renamed follows the code and writes an erratum.
- Section P5 lists the work packages. Read P1, then your package, then the sections it names.

Contents: P1 principles - P2 build or reuse - P3 the additions - P4 data and contracts - P5 work
packages - P6 order, branch and integration - P7 risks and open decisions - P8 out of scope and
deferred.

Why this stage exists. The project's owner used the public preview and asked for: rearranging panels
as in Visual Studio Code; selecting several files and deleting or exporting them together, with a
confirmation; a way back after saving or deleting the wrong thing; seeing what Export will export;
seeing a PDF as a PDF; knowing how much the browser holds and being warned before a large import; and
seeing that a file opened "From this computer..." is edited in place on the disk. The owner also
decided what is NOT built (P8): no help with writing code, no command palette, no Git inside the
application in this stage.

---

## P1. Principles

### P1.1 What may never change

1. **Program behaviour.** Everything listed in main §0 rule 1 stays exactly as it is: assembler
   output, CPU results, cycles, TRAP #15 results, pixels, devices, the bytes of listing, S-record and
   log files, and which files a program can reach, except that, beyond the snapshot limits
   (`DEFAULT_SNAPSHOT_LIMITS`), files below a folder named `.git` are the ones left out first
   (P3.3.10, R6). No code of this stage calls the engines except through the existing services.
2. **Files.** The application writes the same bytes as today to `.X68`, `.L68`, `.S68`, log files and
   the three files of the original's settings (`settings.dat`, `sim68K.dat`, `template.NEW`). This
   stage writes into a folder of the student's computer (an opened folder, a linked file's folder,
   the desktop app's disk) only what a command the student gives writes there: Save, Restore,
   Restore from the Trash, Undo, Move, Copy, Rename, Delete. It writes only the files those commands
   name, with their bytes unchanged, and never a temporary, hidden, history or metadata file of its
   own. The one exception is today's (FS1) change of letter case only (`renameEntry` in
   `features/files/store.ts`), which passes through a temporary name `<name>.renaming-<time>` next to
   the item and removes it at once; this stage keeps it as it is. No command this stage adds (the
   Files panel's Delete, Move, Copy, Rename, Export, Trash restore, Undo, Earlier Versions Restore)
   writes, deletes, moves or copies anything below a folder named `.git` (any letter case). Save,
   Save As, Import and a 68000 program's file operations are unchanged, also below `.git`.
3. **Menus, commands, keys.** Every item of the original menus keeps its caption, position, access
   key and shortcut; the Editor's Window menu keeps its numbered document list directly after
   `Minimize All`. Every chord of `app/src/commands/tables/keys.ts` keeps its command. Additions to a
   menu come after the original items of that menu (after the document list in the Window menu),
   below a separator, as main §1.5 already does. No addition takes a chord of the original, a chord
   of main §1.5, or a chord browsers reserve (main §2.9.3).
4. **Panel visibility is program state.** Showing the Hardware panel zeroes the switch byte (main
   §2.4, hardware §2.4; `features/hardware/index.ts` follows `isPanelVisible`). Therefore: moving,
   docking, splitting, locking or resetting the layout **never changes** `AppSettings.layout.panels[id].visible`.
   Only the existing commands and the `x` of a tab change it, and every `x`, key or menu item that
   closes a panel's tab goes through `hidePanel` (P2.2, `onAction`).
5. **The Output panel's keyboard rules** (main §2.9.4) stay as they are in every arrangement. No
   component added by this stage handles a key event whose target is inside
   `[data-e68-keys="program"]`.

### P1.2 How additions stay additions

- Every addition is reachable from a menu (below the separator rule above) or from the Files panel's
  own strip and context menu. Nothing is reachable only by dragging or only by a key.
- The defaults reproduce today's arrangement (`Reset Layout`, P3.1.3). `Lock Layout` (P3.1.4) is on
  by default (D2) and gives today's look exactly; unlocked, each group of panels also shows its tab
  strip, which is what makes dragging possible. `Move Panel To...` works in both states.
- **The two switches.** The additions that change what happens when the student does something they
  did before are switched in one dialog, `Options > Port Additions...` (P3.5):
  - `viewer` (default on): opening a PDF, a picture or another non-text file shows the viewer
    (P3.4). Off: every file opens as text, as in the original.
  - `history` (default on): saving keeps earlier versions, deleting in the Files panel moves to the
    Trash, and Replace and Restore keep a copy of the file they write over (P3.3). Off: nothing is
    kept. Delete is permanent after its question, as today, except that a folder holding `.git` is
    still refused (D8); Replace and Earlier Versions' Restore say that they cannot be undone before
    they act (P3.3.4).
  The editor itself behaves exactly as today in all cases: this stage adds nothing to typing,
  completion, markers or the editor's keys (P8).
- The layout additions need no switch: `Lock Layout` (on by default) gives today's look and
  behaviour, and `Reset Layout` today's arrangement.
- The reload offer of P3.3.10 has no switch either. It appears only when the file under an open,
  unmodified document was changed outside this window (another window, Git, another program), a
  case in which today the window keeps showing the old text and its next Save asks main §3.8.6
  rule 3's question; it changes nothing unless `Reload` is chosen.
- The two switches are "on" because the owner asked for the additions and none of them can surprise a
  student who does not use them: the history is invisible until looked for; the viewer shows PDFs, pictures
  (including SVG, which the original showed as its XML text) and files with a zero byte in their
  first 8,192 bytes.

### P1.3 Keys

The chord table is `app/src/commands/tables/keys.ts` with the rules K1 to K6 written at its top.
This stage adds **no global chord**. Every new command is in a menu and has no key: a student finds
them in the menu, and none is used so often that a shortcut would pay for the risk of colliding with
a browser (main §2.9.3) or a future addition. Chords considered and not taken: Ctrl+Shift+P /
Shift+Cmd+P (Firefox reserves Ctrl+Shift+P for a private window), Ctrl+\ / Cmd+\ (would be "split
editor"; not needed, `Split Editor Right` is in the Window menu), F6 (guarded chord, Pause in the
simulator).

Keys that act only while a particular widget has the focus (they are not commands; they never reach
the dispatcher's command steps because the widget owns them or no command is bound):

| Widget | Windows and Linux | macOS | Why it cannot collide |
|---|---|---|---|
| Files tree: extend selection | Shift+Up, Shift+Down, Shift+Home, Shift+End | same | no command is bound to these chords |
| Files tree: move focus without selecting | Ctrl+Up, Ctrl+Down | Option+Up, Option+Down | not bound; Ctrl+Up/Down on macOS are Mission Control, so Option is used there |
| Files tree: add or remove the focused row | Ctrl+Space (Ctrl+click does the same) | Option+Space (Cmd+click does the same) | not bound; Ctrl+Space on macOS switches the input source, and on Windows an East Asian input method may take Ctrl+Space, which is why the click is named too |
| Files tree: select all visible rows | Ctrl+A | Cmd+A, Ctrl+A | bound to `ed.edit.selectAll`: the tree owns it with `data-e68-own-keys` (main 2.9.1, erratum W3 37) |
| Files tree: undo the last file operation | Ctrl+Z | Cmd+Z, Ctrl+Z | bound to `ed.edit.undo`: the tree owns it with `data-e68-own-keys` |
| Files tree: redo | Ctrl+Alt+Z | Shift+Cmd+Z, Ctrl+Option+Z (normal form `Ctrl+Alt+Z`) | bound to `ed.edit.redo`: the tree owns them and does nothing (the Files panel has no redo), so that Redo never acts on the editor while the tree has the focus |
| Files tree: delete the selection | Delete | Delete, Cmd+Backspace (the Mac's delete key is reported as Backspace) | not bound |
| Files tree: rename | F2 (one row selected) | F2 | already FS1's; F2 is bound only in Simulator mode (`sim.panel.next`) |
| Files tree: clear a multi-selection | Esc | Esc | not bound |
| Dock tab strip | Left/Up and Right/Down (previous and next tab), Enter or Space (select), Delete (close a closable tab), Shift+F10 or ContextMenu (our tab menu, which has `Close`) | the same; `Close` is also in the tab menu, because a Mac keyboard may have no Delete key (Fn+Backspace gives Delete) | FlexLayout 0.11.x's tab keys (it has no Home or End in a tab strip), configured as P2.2 says |
| Trash dialog's list | the tree's keys: Shift+Up, Shift+Down (extend), Ctrl+Space (add or remove the focused row), Ctrl+A (all rows) | Shift+Up, Shift+Down, Option+Space, Cmd+A | the dialog is modal; the dispatcher runs nothing while it is open |
| History and Trash dialogs, otherwise | the kit's `DataGrid` and `Dialog` keys | same | dialogs are modal; the dispatcher runs nothing while they are open |

The tree's attribute is exactly `data-e68-own-keys="Ctrl+A Ctrl+Z Ctrl+Alt+Z"` on the Windows and
Linux key map and `data-e68-own-keys="Cmd+A Ctrl+A Cmd+Z Ctrl+Z Shift+Cmd+Z Ctrl+Alt+Z"` on the macOS
key map: the chords of `ed.edit.selectAll`, `ed.edit.undo` and `ed.edit.redo` on that key map, each
passed through `normalizeChord` of `commands/chords.ts` (modifiers in the order Ctrl, Alt, Shift,
Cmd; Option is `Alt`), built from the key map, not typed by hand. N5's unit test asserts that every
token equals `normalizeChord` of one of those chords. The browser checks of N5 press each chord
through the key map of the system under test (`tests/e2e/fixtures/keys.ts`).

On touch screens, HTML drag and drop of tabs and rows may not work; `Move Panel To...` (menu) and
the Files panel's `Move To...` (context menu) are the paths for moving panels and files
there.

---

## P2. Build or reuse

Rule: reuse is the default. Writing our own needs a reason, and the reason is written here. Every
candidate is checked against: licence and whether it may be distributed with this GPL-2.0-or-later
project; maintenance; size in the production build; install scripts (the root `package.json` has an
`allowScripts` policy); the production Content Security Policy (`tools/vite-csp-plugin.mjs`, main
§7.6); offline and sub-path use; Chromium and WebKit; theming with the project's tokens in both
themes (main §2.8); keyboard and screen-reader rules (main §2.9 to §2.11).

Facts below were read from the npm registry and the packages' own files for this design. Sizes are
estimates; N0 measures the real increase of the minified production build and records it in
`docs/requests/N0.md`.

### P2.1 Decisions per addition

| Addition | Built on | Why |
|---|---|---|
| Docking layout, tabs of panels, resizing groups | **FlexLayout** (`flexlayout-react`) | see P2.2 |
| Editor split side by side and one above the other | the editor's **existing two-pane model** (`ui/editor/panes.ts`, Tile Horizontally / Tile Vertically) | it exists, it is tied to the original's Window menu (Cascade, Tile), and its tab strip is the kit's `Tabs`; documents are not made FlexLayout tabs (P3.1.7) |
| Moving a document tab to the other pane by dragging | the browser's HTML drag and drop on the kit's `Tabs` (one optional property, P5 N2) | a few lines; no library adds anything |
| Multi-select in the Files tree | the existing `FilesTreeModel` (`features/files/tree-model.ts`) and the kit's `treeViewKeyAction` | the tree has a few hundred rows at most; selection is a set of paths on the model; a tree library would replace a component that already meets main 2.11 |
| Multi-select in the Trash dialog | the kit's `DataGrid` with one optional property (P5 N4) | the grid exists and meets main 2.11; it selects one row today |
| Drag to move in the Files tree | the browser's HTML drag and drop | same reason |
| Folder chooser for `Move To...` | the kit's `Dialog` and `ListBox` over the same tree model | `FileDialogs.chooseFolder` (FS1) chooses a folder in one store at a time and creates typed names; `Move To` must show every store at once and must refuse "Opened from this computer", so it is a `ListBox` dialog of its own |
| Comparing two versions side by side | **`@codemirror/merge`** | CodeMirror 6 is already the editor; its official merge view can be read-only, is themed by the same mechanism as the editor, and is keyboard-accessible as an editor |
| Content hash | the browser's **`crypto.subtle.digest('SHA-256')`** (Node: the same global) | built in |
| Compression of stored versions | the browser's **`CompressionStream('deflate-raw')`** | built in; see P3.3.6 for availability |
| Store of versions and trash | **IndexedDB**, in a database of its own | what the browser store already uses; a database of its own keeps the files' database untouched (P3.3.5) |
| Coordination of windows | **Web Locks** and **BroadcastChannel** | what main §3.8.6 already uses |
| Version control engine | none in this stage (option A, P3.3.2) | the need is recovery; P3.3.2 compares with isomorphic-git in numbers |
| Showing a PDF | the browser's **built-in PDF viewer** in an `iframe` | no PDF library: PDF.js (`pdfjs-dist`) is Apache-2.0 (P2.3) and about 1 MB |
| Showing a picture | the browser's `<img>` | built in; SVG through `<img>` runs no script |
| Measuring storage | `navigator.storage.estimate()` | built in; absent in some contexts, then not shown |
| Download of a bulk export | the existing store-only zip writer `fs/zip.ts` and `features/files/browser-io.ts` `downloadBytes` | exist |
| Download from the viewer | a function of its own in `features/viewer` (the dozen lines of `downloadBytes`, type `application/octet-stream`) | a feature may not import another feature (ESLint layer rule); the function is too small to move into the kit |

### P2.2 Docking: FlexLayout, after a comparison

| | FlexLayout (`flexlayout-react`) | Dockview (`dockview`) | Writing our own |
|---|---|---|---|
| Licence | MIT (copyright Caplin Systems Ltd) | MIT core; **keyboard docking, spatial keyboard navigation, "dock to edge" groups and layout history are commercial** (dockview.dev, "Licensing") | GPL-2.0-or-later |
| Version to pin | the newest `0.11.x` that is at least 14 days old when N0 adds it: `0.11.2` (published 2026-11-16) from 2026-11-30, otherwise `0.11.1` (2026-09-26); pre-1.0, pinned exactly | `8.9.1` | - |
| Runtime dependencies | none; peer `react`, `react-dom` `^18 \|\| ^19` (the app has 19.3.1) | `dockview-core` | - |
| Install script | none (`prepack` only, which runs only when the package is packed) | none | - |
| Size, gzip | about 53 kB minified (bundlephobia); the unminified ESM is about 82 kB gzip, plus `style/light.css` (28 kB raw) | about 91 kB | estimated 2,500 lines plus tests |
| Model | a JSON model with an actions API (`Actions.moveNode`, `addNode`, `deleteTab`, `selectTab`, `adjustWeights`): every move a menu command makes is one action | panels API (`moveTo`) | - |
| ARIA | `tablist`/`tab`/`tabpanel`; splitters are `separator` with `aria-orientation` and `aria-valuenow/min/max`, all with one shared label (`I18nLabel.Splitter`); menus `menu`/`menuitem`; `aria-keyshortcuts` | `tablist`/`tab`/`tabpanel`, groups are `region`, live announcements | ours |
| Keys | configurable `keyMap` (`closeTab`, `renameTab`, `focusTabToggle`, `focusNextTabset`, `focusPreviousTabset`, `closeOverlayBorder`), one chord per binding; each binding can be set or switched off (WCAG 2.1.4); fixed widget keys only (arrows in a tab list, Enter/Space; no Home or End) | keyboard docking only in the commercial part | ours |
| Theming | CSS custom properties `--flexlayout-*`, light and dark | CSS custom properties `--dv-*` | tokens directly |
| CSP | a stylesheet file and inline `style` attributes (allowed: `style-src 'self' 'unsafe-inline'`); no `eval`; no `url()` assets; a `<style>` element only for popout windows, which are switched off | similar | - |
| State of moved panels | keeps component state when a tab is moved (README: "Preservation of component state when tabs are moved") | element moved between groups; `renderer: 'always'` keeps hidden panels | ours |
| Maintenance | developed by Caplin Systems (`github.com/caplin/FlexLayout`), published from one npm account; 17 releases in 2026 (to 2026-11-16), the minor lines 0.9, 0.10 and 0.11 within six months | - | - |

Decision: **FlexLayout, pinned as above.** It is MIT with nothing held back, has no dependencies and
no install script, is the smaller of the two, its model is plain JSON with an actions API (which is
what the keyboard and menu path of P3.1.4 needs: we make every move ourselves through the same
actions a drag makes), its keymap can be cut down to what we choose, and it is themed with CSS
variables that we map to our tokens. Dockview is rejected because the parts we would need for
keyboard users are commercial and could not be distributed under the GPL, and we would have to write
them anyway. Writing our own is rejected because drag previews, drop targets, tab overflow, splitter
maths and nested rows and columns are exactly what is hard to get right and FlexLayout already does
them. Three breaking minor lines in six months is the cost; R1 answers it.

What we still write ourselves, with reasons: the conversion between FlexLayout's model and our stored
layout (so that the stored format does not depend on the library's version, P4.2); the "Move Panel
To..." dialog (no library offers a dialog that names places in words); the rules that tie the layout
to panel visibility (P1.1 rule 4) and to the content-sized groups (P3.1.5).

Conditions of use, each a row of N1's unit test of the model options and checked in its browser
checks (P5). Attribute names are those of 0.11.x's `IJsonModel`; N1 writes any that differ in its
erratum.

- Global attributes: `tabEnableRenderOnDemand: false` (every visible panel is mounted once its dock
  has been shown and laid out, and then stays mounted behind another tab and while its workspace is
  hidden, main §2.3, last paragraph; FlexLayout 0.11.x mounts a tab's content only once its group has
  a size above 0 x 0), `tabEnablePopout: false`, `tabEnableFloat: false`, `tabEnableRename: false`,
  `tabSetEnableMaximize: false` (no maximize by double-click), `tabSetEnableClose: false`,
  `tabSetEnableTabGroups: false`, `tabSetEnableActiveIcon: false`, `tabSetEnableCloseButton: false`,
  `tabSetEnableDeleteWhenEmpty: true`, `enableEdgeDock: true`. No borders. FlexLayout's built-in tab
  context menu is not used: the tab menu of P3.1.4 is ours.
- Per tab: `enableClose: true` only for `files`, the tool panels and viewers; `false` for `editor`,
  `messages`, `registers`, `listing`, `output`. While the layout is locked: `enableDrag: false` on
  every tab, `tabSetEnableDrag: false`, and `enableTabStrip: false` on every group that P3.1.4 shows
  without a strip.
- `keyMap: { closeTab: 'Delete', renameTab: undefined, focusTabToggle: undefined, focusNextTabset:
  undefined, focusPreviousTabset: undefined, closeOverlayBorder: undefined }` on both key maps, each
  key passed explicitly, because FlexLayout merges the given map over its `defaultKeyMap`
  (`closeTab: 'Ctrl+Delete'`, `renameTab: 'F2'`, `closeOverlayBorder: 'Escape'`); F2 is the port's
  panel cycle. A binding takes one chord.
- `Layout.onAction` sees every action. `Actions.DELETE_TAB` of a closable panel is turned into
  `hidePanel(ctx, id)` (which removes the tab through the dock controller, P3.1.5) and the action
  itself returns `undefined`; for a viewer it closes the viewer; for any other panel it is refused.
  `Actions.DELETE_TABSET` is refused for any group that holds a panel. For a group action
  (`Actions.group`, as FlexLayout's close-all and close-others make) the same rules apply to each
  contained action, and the whole group is refused if any part is refused. A drag of a panel while
  locked is refused. Nothing removes a panel's tab without going through `hidePanel`.
- `model.setOnAllowDrop` refuses a drop of `output` whose target rectangle is smaller than
  160 x 120 px.
- Splitter names: FlexLayout 0.11.x gives every splitter the one label
  `i18nTranslator(I18nLabel.Splitter)` and sets `aria-valuetext` itself (`<n>%` or `<n>px`). The dock
  passes an `i18nTranslator` that maps `I18nLabel.Splitter` to `Resize`. After each layout change
  (`onModelChange`, and once after mounting), `ui/dock` sets `aria-label` on each
  `.flexlayout__splitter` element: in the default arrangement today's names (`Resize the Files
  panel`, `Resize the Messages panel`, `Resize the two columns`, `Resize the tool panels`), elsewhere
  `Resize <panel> and <panel>` (the titles of the selected tabs on its two sides). This holds because
  React does not rewrite an attribute whose prop did not change; N1's check asserts that the names
  survive a tab switch, a splitter drag, a move and a font change. If it does not hold, every
  splitter is named `Resize`, N1 writes the erratum against main §2.11, and N1 changes
  `check-shell.mjs`, `shell.test.tsx` and `tests/e2e/app/layout.spec.ts` to match in the same merge.
- The `Layout` is rendered with `invalidateTabContentOnParentRender={false}` and, under
  `prefers-reduced-motion: reduce`, `tabDragSpeed={0}`; the dock dispatches no action when a reveal
  finds the panel already present and selected (P3.1.5).
- No ancestor of a panel's content, up to the document's root, creates a stacking context or a
  containing block for fixed-position descendants: no `transform`, `filter`, `perspective`,
  `contain`, `container-type`, `will-change`, `opacity` below 1, `isolation`, `backdrop-filter`,
  `mix-blend-mode`, or a `position` with a `z-index`. The dock sets no `z-index` on any of its layers
  (FlexLayout's `.flexlayout__tab` has none; its splitters have 10, below the full screen's
  `calc(var(--z-modeless) - 1)`). Reason: the Output panel's full screen is `position: fixed; inset:
  0` inside the panel (`features/output/output.css`, `.e68-output[data-fullscreen='true']`) and covers
  the window only by its z-order.
- The stylesheet `flexlayout-react/style/light.css` is imported once, in `app/src/ui/dock`, and
  overridden there (P3.1.8, Themes).

N0 records in `docs/requests/N0.md` the version it pinned, its publication date, the date of the
newest release, and that the version is at least 14 days old.

### P2.3 Licences

The project is GPL-2.0-or-later. MIT, BSD and ISC code may be bundled. Apache-2.0 code is compatible
with GPL version 3 only: bundling it makes the combined work distributable under GPL-3.0-or-later.
**This stage bundles no Apache-2.0 code**, so the licence of the distributed application stays
GPL-2.0-or-later. Two candidates were set aside for this reason among others: PDF.js (Apache-2.0)
and isomorphic-git, whose own licence is MIT but whose runtime dependencies `crc-32` (1.2.2) and
`clean-git-ref` (2.0.1) are Apache-2.0 (P3.3.2).

### P2.4 New dependencies, all in one place

One engineer (package N0) adds them at once, with `npm ci` afterwards, never `npm install <package>`
in another package (main §8, "shared configuration").

| Package | Version (exact) | Licence | Where | Install script | Loaded | Size, gzip |
|---|---|---|---|---|---|---|
| `flexlayout-react` | as P2.2 says | MIT | `app/package.json` dependencies | none | at start (Editor and Simulator mode) | about 53 kB minified |
| `@codemirror/merge` | `6.12.3` (published 2026-10-19) | MIT | `app/package.json` dependencies | none (`prepare` runs only for git installs) | on demand: a dynamic `import()` when a comparison opens | about 15 to 20 kB for merge itself; the rest is already in the build |

`@codemirror/merge` depends on `@codemirror/language`, `@codemirror/state`, `@codemirror/view`,
`@lezer/highlight` and `style-mod`. All of them, and `@codemirror/language`'s own dependencies
(`@lezer/common`, `@lezer/lr`, `@codemirror/streamparser`, `crelt`, `w3c-keyname`,
`@marijn/find-cluster-break`), are already in `package-lock.json` (`@codemirror/language` 6.13.1
through `@codemirror/commands`), all MIT. No file of the application imports `@codemirror/language`,
so it is not a direct dependency and not on the closed list. N0 lists every package the lockfile
adds or changes, with its licence, in `docs/requests/N0.md`, and the integration pass rejects one that
is not MIT, BSD or ISC.

The closed list of runtime dependencies in main §3.1 grows by `flexlayout-react` and
`@codemirror/merge`. In `eslint.config.js` (N0):

- `RUNTIME_PACKAGES` stays as it is. A new map `FOLDER_PACKAGES` gives packages that only one folder
  may import: `flexlayout-react` only under `app/src/ui/dock/**`, `@codemirror/merge` only under
  `app/src/features/history/**`. The rule `easy68k/layer-imports` allows a package of that map in its
  folder and reports it everywhere else.
- `fs/` may also import `core/history` (the pure logic of `fs/history-db.ts`, P5 N3).
- `features/history/` may also import the one file `ui/editor/fonts.ts` (the editor's font for the
  comparison).
- `ui/dock/` is a layer of its own: it may import `contracts`, `core`, `state`, `commands`,
  `ui/components`, `ui/shell/PanelRegion.tsx`, `ui/shell/SplitPane.tsx` (`useElementSize`, for the
  1100 px switch), the runtime packages (`RUNTIME_PACKAGES`) and `flexlayout-react`; features never
  import it (they reach the dock through `state/dock.ts`, which imports neither `ui/dock` nor
  `flexlayout-react`).
- `tests/lint/import-rules.test.ts` gains one passing and one failing case for each of these.

Expected increase of the production build: about 55 kB gzip loaded at start (FlexLayout and our own
layout code), about 20 kB gzip loaded on first comparison, and about 25 kB gzip of our own code for
the Files panel, history and viewer. The service worker precaches every file of the build manifest,
so the lazily loaded chunk works offline (N0 checks that the chunk is in the manifest).

---

## P3. The additions

### P3.1 Layout: panels that can be moved, docked and grouped

#### P3.1.1 What the student sees

- In Editor mode and Simulator mode every panel has a **tab** with its title. Panels that share a
  place are tabs of one **group**; a group shows the panel of its selected tab. Groups are arranged in
  rows and columns separated by splitters that can be dragged (as today) and moved with the arrow keys
  (as the kit's Splitter does today).
- With the layout unlocked (`Lock Layout` unchecked, P3.1.4; it is checked by default), a panel is
  moved by **dragging its tab**: while dragging, the group under the pointer shows where the
  panel would go: as a tab of that group (the tab strip or the centre), or beside it on the left,
  right, top or bottom (the four edges); the window's own edges dock it along the whole window.
  Releasing drops it there; Esc cancels. Tabs are reordered within a group by dragging along the strip.
- Every move, the order of tabs in a group included, can also be made with the keyboard and from the
  menu, locked or not: `Move Panel To...` and the tab menu (P3.1.4).
- The editor area (the document tabs, the editor, its status bar) is one panel, `Editor`. It can be
  moved like any other panel and cannot be closed.
- EASyBIN mode has one panel (the EASyBIN workspace); it has nothing to arrange and gets no layout
  commands.
- The Help drawer stays a drawer at the window's right edge, as today, in every mode, and is not a
  dockable panel (reason in P3.1.7).

#### P3.1.2 Panels, by mode

| Mode | Panel id | Title | Can be closed (its `x`) | Default place |
|---|---|---|---|---|
| Editor | `files` | Files | yes: hides it, as `app.files.toggle` does | left column |
| Editor | `editor` | Editor | no | centre, top |
| Editor | `messages` | Messages | no | centre, below the editor |
| Editor | `viewer:<n>` | the file's name | yes: closes the viewer | as a tab of the group that holds `editor` (P3.4) |
| Simulator | `registers` | Registers | no | left column, top |
| Simulator | `listing` | Listing | no | left column, middle |
| Simulator | `messages` | Messages | no | left column, bottom |
| Simulator | `output` | Output | no (it can be collapsed, as today) | right column, top |
| Simulator | `memory`, `stack`, `hardware`, `breakpoints`, `log` | Memory, Stack, Hardware, Break Points, Log | yes: hides it (today's tool tab `x`, `hidePanel`) | one group, right column, below Output, in this tab order |

The fixed ids are the panel and region ids of `state/layout.ts` (`PANEL_IDS`, `REGION_IDS`); none is
renamed. `PanelSpec` (contracts) is unchanged: the dock places the component of the `PanelSpec` with
that id, inside the same `PanelRegion` element as today (`ui/shell/PanelRegion.tsx`: `data-e68-panel`,
its error boundary, its `region` or `tabpanel` role), so every selector and focus rule that finds a
panel by `data-e68-panel` keeps working.

Viewers are **transient panels**: they are not `PanelSpec`s, not in the `PanelRegistry` and never
stored. The dock controller opens them through `openTransient` (P4.4) with their own title and
content, inside an element that carries `data-e68-panel="viewer:<n>"` (its own id) and the role
`tabpanel`.

#### P3.1.3 Default arrangement and Reset Layout

The default arrangement of each mode is today's: the same panels in the same places with the same
proportions. While a mode's arrangement is the default, its splitters are today's: the four of
`SPLITS` (`editor.files`, `sim.columns`, `sim.messages`, `sim.tools`), sized from
`AppSettings.layout.splits` (or the defaults in `SPLITS`, `state/layout.ts`, when nothing is stored),
whose drag writes `layout.splits` as today; and the Editor's messages splitter (`Resize the Messages
panel`, `EditorCenter` in `ui/shell/EditorWorkspace.tsx`), whose drag sets the message list's height
until the list changes, as today, and is never stored (P3.1.5). A student who resized the panels before this stage finds
the same sizes, and a 1.0 window open at the same time keeps working with them. That is the whole
migration (P4.2).

What makes an arrangement **changed**: moving a panel to another place (drag, `Move Panel To...`, the
tab menu) or reordering tabs in a group. A splitter drag, showing or hiding a panel, selecting a tab
and collapsing the Output panel do not: the arrangement stays the default. From the first change on,
the mode's whole tree, with its weights, is stored in `layout.dock` (P4.2), and its splitters write
only there.

Below 1100 px of window width, Simulator mode's default arrangement is today's narrow one (the right
column under the left one; Output the first tab of the tool group). While the simulator's arrangement
is the default, the window switches between the wide and the narrow default at 1100 px as it does
today. Once it is changed, that arrangement is used at every width.

`Reset Layout` puts the current mode's arrangement back to the default (wide or narrow by the
window's width), removes that mode's tree from `layout.dock`, and sets that mode's entries of
`layout.splits` to the defaults of `SPLITS`. It does **not** change which panels are visible
(P1.1 rule 4), `Lock Layout`, the editor's `Tile` state, the Output zoom or the Help drawer.

#### P3.1.4 Commands

| Caption | id | kind | Menu place | Win/Linux | macOS | Enabled |
|---|---|---|---|---|---|---|
| `Mo&ve Panel To...` | `app.layout.move` (arg: `{ panel?: string }`) | action | Editor: Window menu, after the document list, below a separator. Simulator: end of the View menu, below a separator after `Log` | - | - | in Editor and Simulator mode, locked or not |
| `Split Editor &Right` | `ed.window.splitRight` | action | Editor: Window menu, after `Move Panel To...` | - | - | a document is open |
| `Split Editor &Down` | `ed.window.splitDown` | action | Editor: Window menu, next | - | - | a document is open |
| `Close &Split` | `ed.window.unsplit` | action | Editor: Window menu, next | - | - | the editor has two panes |
| `Loc&k Layout` | `app.layout.lock` | check | Editor: Window menu, after a separator; Simulator: View menu, after `Move Panel To...` | - | - | Editor and Simulator mode |
| `R&eset Layout` (Editor) / `Reset La&yout` (Simulator, caption override in the table) | `app.layout.reset` | action | after `Lock Layout` | - | - | Editor and Simulator mode |

The Editor's Window menu is therefore: `Arrange`, `Cascade`, `Tile Horizontally`, `Tile
Vertically`, `Minimize All`, the document list (with its own separator, `menus.ts`
`resolveDocuments`), a separator, `Move Panel To...`, `Split Editor Right`, `Split Editor Down`,
`Close Split`, a separator, `Lock Layout`, `Reset Layout`. In `tables/editor-menu.ts` the additions
follow `{ type: 'documents' }` after a `separator`; `MenuTable` needs no change, because
`resolveNodes` already drops a doubled separator when no document is open. `tables.test.ts` gains a
test that the original items and `{ type: 'documents' }` keep their indexes.

`ed.window.splitRight`: with one pane, does what `Tile Vertically` does (`setLayout('vertical')`, which
moves the active document into the second pane when every document is in one, `tilePanes`); with two
panes side by side, moves the active document to the other pane (`moveToOtherPane`); with two panes
one above the other, switches to side by side and moves the active document to the other pane.
`ed.window.splitDown` is the same with `horizontal`. `ed.window.unsplit` does what `Cascade` does.
These three commands exist so that the split is reachable under names a student from another editor
looks for; the original's `Cascade`, `Tile Horizontally`, `Tile Vertically` keep their behaviour.

**`Move Panel To...`** opens the modal dialog `layout.move`:

```
+-- Move Panel -----------------------------------------------+
| &Panel:   [ Files              v ]                           |
| &Place:   ( ) Into the group of [ Editor        v ] as a tab |
|           ( ) Beside [ Editor        v ]: [ Left  v ]       |
|           ( ) At the edge of the window: [ Left  v ]         |
|                                          [  OK  ] [ Cancel ] |
+--------------------------------------------------------------+
```

- `Panel` lists the visible panels of the mode by title, open viewers included (`describe()`, P4.4);
  it starts on the panel that holds the focus (or `arg.panel`), else the first.
- The second list of the first two choices lists the other visible panels; the side lists are `Left`,
  `Right`, `Above`, `Below` (beside) and `Left`, `Right`, `Top`, `Bottom` (window edge). `Into the
  group of X as a tab` adds the panel as the last tab of that group.
- OK applies one FlexLayout action (`Actions.moveNode` with the target node and location) and moves
  the focus into the moved panel; the live region of P3.1.8 announces it. A choice that would change
  nothing is still accepted and does nothing.
- The tab menu (Shift+F10, the context-menu key or a right click on a panel's tab) lists, for that
  panel: `Move To...` (the same dialog), `Move Left`, `Move Right`, `Move Up`, `Move Down` (one step:
  beside the neighbouring group in that direction, or to the window edge when there is none), `Move
  Tab Earlier` and `Move Tab Later` (one place along the same group's strip, `Actions.moveNode` into
  the same tabset at the index one lower or higher; disabled at the first and the last place and in a
  group of one panel), and `Close` where the panel can be closed (through `hidePanel`). Each runs the
  same actions. The tab
  menu is drawn by `ui/dock` (FlexLayout's `onContextMenu` and the tab button's Shift+F10 and
  ContextMenu keys) with the kit's `ContextMenu`; `Move To...` runs `app.layout.move` with
  `{ panel }`, the others the actions of `ui/dock/actions.ts`. `features/layout` owns the commands and
  the dialog only.

**Tab strips and `Lock Layout`** (checked = locked):

- Locked (the default, D2): a group shows its tab strip only where today's layout shows one: when it
  holds more than one panel, or when it holds tool panels (Memory, Stack, Hardware, Break Points,
  Log), whose strip today stays even with one tab because it carries their `x`, or when it holds a
  viewer (its strip carries the viewer's `x`). Every other group shows no strip, so that the window
  looks exactly as it does today. Tabs cannot be dragged.
  `Move Panel To...` and the tab menu (on a strip that is shown) stay enabled; a move made from them
  keeps the lock.
- Unlocked: every group shows its tab strip (30 px of tabs and a 1 px border, as the kit's tool
  strip today). The strip is what a panel is dragged by.

#### P3.1.5 What depends on today's fixed regions, and what happens to it

| Today | With the dock |
|---|---|
| The eleven panel ids of main §2.4 and the regions `editor`, `easybin`, `status` (`state/layout.ts`) | unchanged; `status` and `easybin` are not dock panels (the status bar stays below the window, EASyBIN mode has one panel) |
| `PanelSpec` | unchanged |
| `showPanel(ctx, id)` | unchanged meaning: sets `visible` (unchanged code), then asks the dock controller to make the panel present (`reveal`: added back at its remembered place, P4.2 `parked`) and its tab selected, then moves the focus as today. `reveal` dispatches no action when the panel is already present and selected, so a running program's output (`session.ui.showOutput`, `showPanel('output', { focus: false })`) costs nothing |
| `hidePanel(ctx, id)` | for `output`: unchanged (it sets only `outputCollapsed`); `park` is never called for `output`, its tab stays in the model and its content stays mounted, hidden, with today's expand button drawn by the dock in the same tab. For every other panel: unchanged meaning, sets `visible: false`, and the controller removes the tab and records where it was (`park`). Every close of a tab, by its `x`, the Delete key or the tab menu, arrives here (P2.2, `onAction`) |
| `togglePanel`, `panelVisible` | unchanged |
| `focusPanel(ctx, id)` | selects the panel's tab first, then the shell's focus request runs as today |
| `focusNextPanel(ctx)` (F2, Ctrl+Tab, the release chord) | unchanged order `PANEL_CYCLE`, whatever the arrangement; it selects the target's tab before focusing it |
| `focusPanelElement` | finds the region that is rendered visible: `element.checkVisibility({ visibilityProperty: true })` where it exists, otherwise `offsetParent !== null` and a computed `visibility` that is not `hidden`, or the element is the full-screen element; instead of "not inside `[hidden]`", because FlexLayout hides unselected tabs with styles |
| `ShellState.activeTool`, `outputInFront` | replaced by the dock's selected tabs; the fields stay in `ShellState` and are kept in step (the selected tab of the group that holds the tool panels) for code that reads them |
| `ShellState.outputCollapsed` | unchanged; the dock (`ui/dock`, N1) draws today's expand button (now drawn by `SimWorkspace.tsx`) in place of a collapsed Output panel's content, so `features/output` does not change |
| The View menu items and their shortcuts | unchanged; each calls `showPanel`, which works wherever the panel is |
| The Output panel's full screen | unchanged code; condition of P2.2 on ancestors; no `z-index` is set on any dock layer, and no DOM node is moved outside React. If N1's `elementFromPoint` check fails in an arrangement, the dock gives the `.flexlayout__tab` element that holds the Output panel `z-index: calc(var(--z-modeless) - 1)` (the value `output.css` uses) while full screen only, and N1 records it in its erratum. N1's check enters full screen in three arrangements and asserts that `document.elementFromPoint` at the four corners and the centre of the window returns an element inside `[data-e68-panel=output]` |
| The Output panel's keyboard capture | unchanged; FlexLayout's key handling is limited to its own tab strip and splitters (P2.2); N1's check types every chord of main §2.9.4 into a running program in two arrangements and compares with today's results |
| Panels that repaint on engine revisions | they mount when their dock is first shown and laid out (P2.2), not at start while the Simulator workspace is hidden; then they stay mounted while hidden behind a tab or while the workspace is hidden, and repaint when shown, as today; tab content is not re-rendered by the dock's own renders (P2.2). The Output panel's driver and key hooks (`output.attachDriver`, `output.attachKeys`) therefore attach on the first switch to Simulator mode. N1's check: start in Editor mode, press F4 and at once F9 on a program that reads a key and draws in full screen; the key typed reaches the program and the full screen covers the window |
| The Hardware panel's "shown" effect | unchanged: tied to `visible` only (P1.1 rule 4); a move does not count as showing it |
| Stored splitter fractions `layout.splits` | used and written by the default arrangement as today (P3.1.3); a changed arrangement does not touch them |
| The Registers panel's height (`e68-region--auto` in `SimWorkspace.tsx`: as tall as its content) | while `registers` is alone in its group at the top of the left column (the default), the dock sets that group's height in pixels to the panel's content height (plus its strip when one is shown), and recomputes it when the font changes. In any other place the group has an ordinary size the student sets |
| The editor's message-list height rule (5 px, 87 px, 7 px; `messagesPaneHeight`) and its splitter `Resize the Messages panel` | applies while `messages` is alone in its group directly below the group that holds `editor` (the default); the dock then sets that group's height in pixels from the rule. A drag of the splitter above it overrides the rule until the message list changes, then the rule decides again, as today (`EditorCenter`); the drag is never stored. In any other place the group has an ordinary size the student sets |
| The Help drawer and its splitter `app.help` | unchanged |
| The narrow simulator layout (main §2.3) | the narrow default arrangement (P3.1.3) |

#### P3.1.6 Persistence

A changed arrangement of each mode is stored in `AppSettings.layout.dock` (P4.2) and survives a
reload. `app.layout` is per window (erratum W3 16): a window that starts takes the layout stored last,
and a change in one window does not move panels in another. Lock state is part of it.

#### P3.1.7 What is deliberately not done

- **Documents are not FlexLayout tabs.** The editor area keeps its own tab strip and its two-pane
  model. Reasons: the Window menu's Cascade / Tile commands and its numbered document list belong to
  the original and are defined on that model; each pane has the per-document status bar of
  editor-ui §7.2; and making documents dock tabs would rewrite E1's and E2's work for little gain,
  since the split side by side and one above the other already exist. Dragging a document's tab onto
  the other pane moves it there (P5 N2).
- **More than two editor panes**: not done (the model has two, as Tile gives two).
- **Help as a dock panel**: not done. It is one component for all three modes and is drawn above a
  modal dialog's backdrop so that a dialog's Help button works (erratum W3 30); three dock copies
  would load the help page three times.
- **Floating panels and panels in separate browser windows**: not done (a second application window
  exists already: `New Window`).
- **Status bars** stay at the bottom of the window.

#### P3.1.8 States and edge cases

- A group whose last panel is closed disappears; its space goes to its neighbours.
- `showPanel` for a panel whose remembered neighbour is hidden puts it in its default place.
- A stored arrangement that names an unknown panel, misses a panel that cannot be closed, or does not
  parse, is replaced by the default arrangement without a message (P4.2 validation).
- The Output panel cannot be dropped into a position smaller than 160 x 120 px; the drop target is not
  offered (P2.2, `setOnAllowDrop`).
- Several windows: each keeps its own arrangement (P3.1.6).
- Keyboard only: every move through `Move Panel To...` or the tab menu; splitters with arrow keys.
- Focus: when a panel or viewer that holds the focus is closed, the focus goes to the panel of the
  selected tab of the same group; if the group disappeared, to the Editor panel (Editor mode) or the
  Registers panel (Simulator mode). `Reset Layout` and `Lock Layout` keep the focus on the element
  that had it (FlexLayout keeps panels mounted across moves, so the element survives).
- Screen readers: each group that shows a strip is a `tablist`, and each of its panels is a
  `tabpanel` (inside it the `PanelRegion` keeps its own name); a group shown without a strip renders
  no `tablist` and no `tabpanel` role, and its content keeps the `PanelRegion`'s `region` role, as
  today; every move, by drag or command, is announced in a polite live region:
  `<Panel> moved beside <Panel>, <side>.` / `<Panel> moved into the group of <Panel>.` /
  `<Panel> moved to the <side> edge of the window.` / `<Panel> moved to position <n> of its group.`
  / `Layout reset.` / `Layout locked.` /
  `Layout unlocked.`
- Reading order: the document order of the groups is to follow their position (rows top to bottom,
  columns left to right). N1 checks it in three arrangements, locked and unlocked, by comparing the
  DOM order of the panels' `PanelRegion` elements with their boxes. If FlexLayout renders tab content
  in a flat layer whose DOM order differs, the dock keeps that layer's children in visual order after
  each layout change, or, if that cannot be done without moving nodes React owns, gives each group's
  `tablist` an `aria-owns` naming its panels; N1 writes which in its erratum.
- Themes: `app/src/ui/dock/dock.css` sets every `--flexlayout-*` variable once, on
  `.flexlayout__layout`, to a `var(--c-*)` token of main §2.8 (the tokens themselves switch with the
  theme under `:root[data-theme="dark"]`, so no second mapping is needed): `--c-panel` for tab strips,
  `--c-surface` for content, `--c-border-strong` for splitters (they are controls: 3:1 against both
  neighbours), `--c-accent` for the selected tab, the drop outline and
  `--flexlayout-color-focus`; focusable dock elements get `outline: var(--focus-ring)` on
  `:focus-visible`. N1 adds the dock's colour pairs to `app/src/styles/contrast.test.ts`.
- `prefers-reduced-motion`: no animation of drop previews (`tabDragSpeed={0}`, P2.2).

### P3.2 Files panel

#### P3.2.1 Selection

- Click selects one row. Shift+click selects the range from the anchor (the row clicked last without
  Shift) to the row. Ctrl+click (macOS Cmd+click) adds or removes a row and makes it the anchor.
- Keys: P1.3 table. Up and Down without modifiers select one row, as today.
- The tree is `role="tree"` with `aria-multiselectable="true"`; each selected row has
  `aria-selected="true"`; the focused row is `aria-activedescendant`, as today.
- A store's root row ("My Programs", the opened folder, "Opened from this computer") can be focused
  and is never part of a multi-selection of more than one row: selecting it alone is allowed (Export of
  the whole store, as today); adding other rows to it, or it to others, drops it from the selection.
- When a selected item is removed (by this window, another window, or the disk), it leaves the
  selection.
- Below the strip, while more than one row is selected, a line says `5 items selected`
  (`role="status"`).

#### P3.2.2 Delete

`Delete` (strip button, context menu, Delete key) acts on the selection.

A folder that holds a folder named `.git` (any letter case, at any depth, or the folder itself) is
not deleted. If the selection holds one, nothing is deleted and the message (`Delete`,
`information`, `OK`) names the selected folder and the folder that holds `.git`: `The folder
"Courses" holds a Git repository ("Courses/lab3"). Nothing was deleted. Delete it with your own tools
if you are sure.` (when the selected folder itself holds `.git`, the parenthesis is left out: `The
folder "demo" holds a Git repository. Nothing was deleted. ...`; with several such folders, the first
in the tree's order is named).

The question (`messageBox`, title `Delete`, icon `confirmation`, buttons `Yes`, `No`; No has the
focus):

| Case | Text |
|---|---|
| one file | `Delete "prog.X68"?` |
| one folder | `Delete the folder "demo" and everything in it (14 files)?` |
| several | `Delete 5 items: "a.X68", "b.X68", the folder "demo" (14 files) and 2 more?` (at most three names, in the tree's order; `and 1 more` / `and N more`) |

Appended to the text, separated by one space, by `ctx.history.state()` when the question is asked:

- `ready`, browser store: `You can restore them from the Trash.` (one item: `You can restore it
  from the Trash.`)
- `ready`, opened folder or the desktop app's disk: `They are deleted from the folder "<label>"
  on this computer. A copy stays in the Trash of EASy68K for up to 30 days.` (one item: `It is
  deleted from the folder "<label>" on this computer. A copy stays in the Trash of EASy68K for up to
  30 days.`)
- any other state, or no history: `This cannot be undone.`

Then each selected item, in the tree's order, is removed through `ctx.history.guard(path, 'delete',
remove, confirm)` (P3.3.4): `remove(seen)` removes, one by one, the files of `seen` (those `guard`
read in phase 1) whose modification time and size are still the ones `seen` gives, then the
folders of the item that are then empty, deepest first; a file that changed or appeared meanwhile
(another window, a program) stays, with its folders. `confirm` asks the question of P3.3.4
(`EASy68K cannot keep a copy of "prog.X68" in the Trash. Delete it anyway? This cannot be undone.`)
when the first question said the item can be restored, and answers Yes at once when that question
already said that it cannot be undone (P3.3.4). `No` there stops: the items not yet deleted stay
selected. If a removal fails, the deletion stops at that item, a message box (`Delete`, icon
`error`) gives the backend's message, and the items not yet deleted stay selected; the files that
were not removed keep their history at their place (P3.3.4). Without `ctx.history` (tests), each
item is removed as today.

After deleting, a toast that counts only the items deleted (none deleted: no toast). It offers the
action `Undo` (P3.2.7) only when every deleted item was kept in the Trash (`guard` said `kept`):
`Deleted 5 items.` (one item: `Deleted "prog.X68".`). When some were deleted for good after the
question of P3.3.4: `Deleted 5 items. 2 of them were deleted for good.` (one item: `Deleted
"prog.X68" for good.`), without an action. When the first question said `This cannot be undone.`:
`Deleted 5 items.` (one item: `Deleted "prog.X68".`) without an action. When files stayed because
they changed meanwhile, the toast adds `1 file changed while it was being deleted and was kept.`
(`<n> files changed while they were being deleted and were kept.`). The same texts apply when the
sequence stopped at `No` or at a failed removal after some items were deleted.

Focus after a delete: the row after the last deleted row, else the row before the first, else the
store's root row.

Linked files (P3.2.5) are not deleted: the command is `Remove from List` with the question
`Remove "lab1.X68" from the Files panel? The file on this computer is not changed.` (several: `Remove
3 files from the Files panel? The files on this computer are not changed.`). In a selection that
mixes linked and other rows, linked rows are removed from the list and the others deleted: `Delete 2
items and remove 1 linked file from the Files panel?` followed by the appended text above.

A file that is open in the editor is deleted as today: the document stays open, and its next Save
writes the file again.

#### P3.2.3 Export

The Export button's accessible name and tool-tip, and the context menu item's caption, say what it
will export:

| Selection | Caption |
|---|---|
| nothing | `Export all of My Programs as My Programs.zip` (today's fallback) |
| a store's root | `Export all of <label> as <label>.zip` |
| one file | `Export "prog.X68"` |
| one folder | `Export the folder "demo" as demo.zip` |
| several | `Export 5 items as EASy68K export.zip` |

Several items become one `.zip` (`fs/zip.ts`), each item at the top level of the archive (a folder
with its contents below its name); a second item with the same name as an earlier one gets ` (2)`,
` (3)` ... before its extension. Items from different stores may be mixed. Folders named `.git` (any
letter case) and everything below them are left out of every export. The toast after it is today's:
`Exported 23 files as EASy68K export.zip.`

#### P3.2.4 Moving

- Dragging selected rows onto a folder row or a store's root row moves them into that folder. Onto a
  file row: into that file's folder. The row under the pointer is outlined; a folder row that stays
  under the pointer for 800 ms expands.
- Same store: move (copy, then remove; `renameEntry`'s rules: nothing is removed until every copy is
  written). Different store (My Programs to an opened folder or back): copy; the drag shows the
  `copy` cursor and the target's tool-tip says `Copy to <place>`.
- Refused targets: a folder into itself or below itself; "Opened from this computer"; a folder named
  `.git` or below one.
- A folder that holds a `.git` folder is not moved, copied or renamed: `The folder "demo" holds a Git
  repository. Move it with your own tools.` (`Move`, `information`, `OK`; for a copy `... Copy it with
  your own tools.`, for a rename `... Rename it with your own tools.`; the nested form of P3.2.2 when
  the `.git` is deeper).
- Folders never conflict, as on import (`features/files/store.ts`, "folders never conflict"): a moved
  or copied folder is merged into a folder of the same name at the target, file by file. Nothing at
  the target is removed except files that are replaced. A folder of the same name at the target that
  holds `.git` refuses the merge, with the text of the bullet above naming that folder.
- A file that exists at both places (letter case ignored: `storedSpelling`): the question
  `"prog.X68" already exists in <place>. Replace it? The file there now goes to the Trash. Choose No
  to skip this item.` (`Yes`, `No`, `Cancel`; several, counted as Import counts them: `3 of the items
  already exist in <place>. Replace them? The files there now go to the Trash. Choose No to skip
  them.`), as Import asks today; when `ctx.history.state()` is not `ready`, its second sentence is
  `This cannot be undone.` For each such file, in this order: (1) if the file to be replaced is
  open in this window's editor and modified, it is skipped with `"prog.X68" has changes that are not
  saved. Save it or close it first, then replace it.` (`Move`, `information`, `OK`), and nothing else
  is done to it; (2) the question; (3) only for a file that will be written, the write, through
  `ctx.history.guard(target, 'replace', write, confirm)` (P3.3.4: the file there goes to the Trash as
  its own `Replaced` item; when no copy can be kept, `confirm` asks the question of P3.3.4, titled
  `Move` or `Copy`, unless (2) said `This cannot be undone.`; `No` skips the file); (4) a replaced
  file whose document is open and not modified: the document is reloaded (`DocumentService.reload`),
  unless the moved file's own document follows to that path (`relocate`, below), in which case the
  target's document is closed instead, so that no two documents name one path.
- Keyboard and menu: the context menu item `Move To...` opens the modal dialog `files.moveTo`: title
  `Move To`, a tree of the folders of all stores except "Opened from this computer" (`ListBox` with
  indentation, the kit's tree keys), buttons `Move` (or `Copy` when the chosen folder is in another
  store) and `Cancel`.
- A moved or renamed file that is open in the editor follows: its document's path changes to the new
  path (`DocumentService.relocate`, P4.4), its text and its modified state stay. A copy leaves the
  document where it was. While `ctx.documents.relocate` is undefined, a move or rename of a file
  that is open as a document is refused: `"prog.X68" is open in the editor. Close it first, then move
  it.` (`Move`, `information`, `OK`; for a rename `... Close it first, then rename it.`, titled
  `Rename`).
- After a move or rename, `ctx.history.moved(from, to)` is called once for each file actually moved
  (written at the target and removed from the source), so its history follows; never for a file
  that was skipped or stayed. A folder rename or move without a merge may call it once for the
  folder. A change of letter case only is a move like any other (P3.3.5).
- After a move a toast `Moved 3 items to demo.` with `Undo`.
- A copy into `/browser/Imported/` of a dropped file or a `From this computer...` file (main
  §3.8.5, erratum FS1 11; `store.ts`, its `replace` callback) that replaces a file with other bytes
  is an import: it keeps the current file as Import does (`before-import`, P3.3.4).
- A drag never carries `Files` in its `dataTransfer` (its type is `application/x-e68-paths`), so the
  window's drop handler of main §3.8.5 does not take it; a drag that leaves the window does nothing.

#### P3.2.5 Linked files and the opened folder, with their real names

- The tree gains a third kind of root, `Opened from this computer`, listing every linked file
  (`/linked/<id>/<name>`) by its name, with the secondary text `edited in place` and the tool-tip
  `Saving writes to the file "lab1.X68" on this computer.` Its context menu: `Open`, `Earlier
  Versions...`, `Export` (downloads a copy), `Remove from List`. The listings and S-records in its
  copy folder are not listed (they are reached from the editor as today). The root is shown only
  when at least one file is linked.
- The opened folder's root shows its label (`folderLabel`, FS2) with the secondary text `on this
  computer` and the tool-tip `Files here are the files of the folder "<name>" on this computer.`
- A `.git` folder (any letter case) in any store is not listed; a root or folder that holds one shows
  the tool-tip line `Git repository (its .git folder is not shown)`.
- The editor's window status bar (`ui/editor/EditorStatusBar.tsx`, `EditorWindowStatus`) and the
  document tab's tool-tip show the place text of P4.5 instead of the internal path:
  `My Programs/demo/prog.X68`, `lab1.X68 - on this computer, edited in place`, `Lab/prog.X68 - in the
  folder "Lab" on this computer`, and in the desktop app the real path as today. The internal path
  `/linked/<id>/...` is never shown.
- `displayPath` (`features/files/store.ts`) uses the same function, so messages name a linked file
  `lab1.X68 (on this computer)` instead of `Linked files/lab1.X68`.

#### P3.2.6 How much is stored, and a question before a large import

- A line at the bottom of the Files panel, in a browser:
  `This site uses 3.4 MB in this browser - Earlier versions and Trash: 1.2 MB - About 1.8 GB free`.
  In the desktop app: `Earlier versions and Trash: 1.2 MB`. It is a button that runs
  `app.additions.options` with `{ group: 'storage' }` (P3.6). Without `navigator.storage.estimate`
  the first and last parts are left out. It is refreshed after every change the panel sees, at most
  once per second. "This site uses" is `estimate().usage` (everything of this site, the application's
  own cached files included); the Storage group of P3.5 breaks it down.
- Before an import (Import Files, Import Folder, a `.zip`, files dropped on the window), when the
  number of files is above 100 or their total size above 10 MB (sizes from the `File` objects; for a
  `.zip`, the sum of its entries after reading it), the question (`Import`, `confirmation`, `Yes`,
  `No`): `Import 312 files (48.2 MB) into My Programs/demo? The browser has about 1.8 GB free for
  this site.` (without an estimate the second sentence is left out).
- When the total size is larger than the free space minus 32 MB: no question, the message (`Import`,
  `warning`, `OK`): `There is not enough room in this browser's storage for 312 files (48.2 MB):
  about 20.1 MB is free. Import fewer files, or delete files you no longer need.` Nothing is
  imported.
- Opened folder and desktop disk as targets: neither question (the student's disk is not the
  browser's storage).
- Sizes are written with one decimal and the units `bytes`, `kB`, `MB`, `GB` (1 kB = 1024 bytes).

#### P3.2.7 Undo in the Files panel

Ctrl+Z (Cmd+Z) in the tree, the toasts' `Undo`, and the context menu item undo the last file
operation of this window. The context menu item's caption names it: `Undo Delete`, `Undo Move`,
`Undo Rename`, `Undo Copy`; with nothing to undo it is `Undo`, disabled. The stack holds the last 20
operations of the window, in memory only (lost on reload); a 21st drops the oldest. Undo is not
offered for imports.

- **Delete**: restores its Trash items through `restoreWithQuestions` (`core/trash-restore`, P4.4,
  titled `Undo`), the same function and questions as the Trash dialog's `Restore` (P3.3.8). An item
  that has expired or was emptied: `"prog.X68" cannot be brought back: it is no longer in the Trash.`
  (`Undo`, `information`, `OK`; the name is the item's path, which the undo stack keeps with its id,
  P3.3.9); `restoreWithQuestions` shows this text itself.
- **Move and rename**: moves each item back, and `moved` changes its history's place back. A
  moved-back file that is open in the editor follows through `relocate`; while `relocate` is
  undefined, Undo of a move of an open file is refused with the text of P3.2.4. An item
  is not moved back when something now exists at its old place: `"prog.X68" cannot be moved back:
  "demo/prog.X68" exists now.`, or when it no longer exists: `"prog.X68" cannot be moved back: it no
  longer exists.` (`Undo`, `information`, `OK`). Moving back never replaces anything; a content
  change since the move is kept, because the file moves with it.
- **Copy**: each copy is removed through `ctx.history.guard(path, 'delete', remove, confirm)`, as
  Delete removes it but without Delete's question, so that an edited copy can still be brought back
  from the Trash. When no copy can be kept, `confirm` asks the question of P3.3.4 (`Undo`: `EASy68K
  cannot keep a copy of "prog.X68" in the Trash. Remove the copy anyway? This cannot be undone.`);
  `No` leaves that copy where it is.
- **Move or Copy that replaced files**: after the step above, the `Replaced` Trash items the command
  made are restored to their places through `restoreWithQuestions`, so that the target is as it was
  before. Its questions are asked only where a place is still taken (a copy that stayed after `No`);
  one that cannot be restored is named with the texts of P3.3.8.

After `Undo` from a toast, the focus goes to the Files tree's row of the first item brought back,
else to the tree's focused row, else to the Editor panel.

### P3.3 The safety net: earlier versions and a Trash

#### P3.3.1 The need, and what must always hold

"Make sure if I save and delete the wrong thing" I can get it back. Recovery must be automatic: a
student who forgets to do something must still be protected. Both options below are automatic.

These properties hold after every operation, in every state, with any number of windows open.
Everything in P3.3 exists to keep them, and N3's model test (P5 N3) checks them after every step:

1. **A current file changes only as commanded.** A current file changes only by the stated effect
   of the command the person gave. The history never writes, moves or removes a current file by
   itself.
2. **Nothing current is destroyed without a copy or a Yes.** Before Delete, a Replace (Move, Copy,
   Restore from the Trash) or Earlier Versions' `Restore` removes or overwrites a current file, its
   current bytes are kept in the history, or the person has been told in one question that this
   cannot be undone and has answered `Yes`.
3. **Saves win.** A save, an open and an import never fail, wait or change because of the history.
   When the history cannot keep a version of them, it keeps nothing and says nothing.
4. **Bounded.** The counted bytes of the earlier versions never exceed `B / 2`, and those of the
   Trash never exceed `B / 2` (P3.3.4), after any operation completes, where `B` is the value the
   writing window read for that operation; after `B` falls, from the end of the next global pass.
5. **Nothing is unreachable.** Every stored content is named by a version; every version belongs to
   one record; a place has at most one living record.
6. **What is shown can be restored.** Every row the dialogs list reads back with exactly its bytes.
7. **Disposable.** Clearing or losing the history never touches a current file. Nothing of the
   history is ever written into a folder of the person's computer, and nothing below `.git` is
   kept (P1.1 rule 2).

**These seven properties outrank every detailed rule of P3.3, of the history contract in P4.4 and
of the acceptance lists of N3, N4 and N5.** The detailed rules were revised several times and may
still contradict one another or one of the properties in a case nobody walked through. Where an
engineer finds such a case, the property wins: they build what keeps the property with the least
departure from the detailed rule, record it as an erratum (`docs/porting/errata/<package>.md`) with
the sequence of steps that shows the conflict, and add that sequence to N3's model test. A detailed
rule is never a reason to break a property, and the model test, not the prose, is the judge.

#### P3.3.2 Two options compared

**Option A - our own history and Trash (recommended).** Every save keeps the saved content as a
version; opening a file keeps its content as a version if it differs from the newest; deleting in
the Files panel moves to a Trash; a version or a Trash item can be compared and restored; undo for
delete, rename and move. Stored in an IndexedDB database of its own, content-addressed and compressed
(P3.3.5). No Git inside the application. A student who wants Git opens a folder of their disk
(Chrome, Edge, the macOS app) and uses ordinary Git there; P3.3.10 makes the application behave well
in such a folder.

**Option B - a Git implementation inside the application** (isomorphic-git) as the engine of the same
automatic safety net (snapshots as commits on a ref of our own, outside the branches), plus a Git
panel (init, status, stage, commit, log, diff, restore).

| | A | B |
|---|---|---|
| What the student gets | earlier versions of every source file they saved, with compare and restore; a 30-day Trash; undo | the same, plus real Git for students who want it inside the browser (no push or pull in the web version: GitHub's Git servers send no CORS headers, so a relay server would be needed, which would see credentials) |
| Packages to build | N3 (store, strongest), N4 (dialogs, mid) | the same two, plus a Vfs-to-isomorphic-git file-system adapter with a separate git directory, a Git panel, and our own garbage collection (strongest, mid, strongest) |
| Own code, rough | about 1,800 lines plus 1,500 lines of tests | about 4,500 lines plus 3,000 lines of tests |
| Added to the production build | about 10 kB gzip of our own code; the merge view (about 20 kB gzip) on demand | about 72 kB gzip for isomorphic-git 1.44.18 (bundlephobia), plus a `Buffer` polyfill and our adapter and panel; the merge view as in A |
| Licence | GPL-2.0-or-later unchanged | isomorphic-git is MIT, but its dependencies `crc-32` and `clean-git-ref` are Apache-2.0: the distributed application would become GPL-3.0-or-later |
| Storage growth | bounded by construction (P3.3.4), with content addressing and compression | Git stores each snapshot as loose objects (blob, trees, commit); isomorphic-git has no `gc`, `prune` or `repack` (its command list), so pruning old snapshots needs our own reachability walk and object deletion |
| Cost of one save | bounded (P3.3.5) | a commit writes at least three objects, each one IndexedDB record; "earlier versions of this file" walks the commit chain, so its cost grows with the number of snapshots unless we keep our own index - which is option A's store again |
| Several windows | one IndexedDB transaction per change; IndexedDB orders them across windows | isomorphic-git serialises within one page only (`async-lock`); every operation would need a Web Lock across windows |
| A corrupt store | the history database can be deleted without touching a file (P3.3.7) | a ref that points at a missing object makes `log` fail; recovery needs Git knowledge we would have to code |
| Clearing the site's data | history goes with the files | the same |
| The stated need | met | met, with much more around it |

Recommendation: **A in this stage.** The need is recovery, and recovery must be automatic either way.
Reuse pays most where the existing thing is hard to get right; here the hard parts of Git (merging,
remotes, packing) are exactly the parts the need does not use, while what the need does use (keep a
version, find the versions of one file, drop old ones within a budget) is small and is what Git's own
data layout makes expensive per file. B would also change the licence of the whole application. A
Git panel can come later as a separate step if students ask for it (P8); it would then work on an
opened folder of the real disk, where real Git already lives.

What A adopts from Git, because it is what makes Git frugal (the owner's question): content
addressing (identical content is stored once and named by its SHA-256), compression of each stored
content, and a layout in which deltas could be added later without changing the version records, as
Git itself first stores whole compressed objects and packs them later. The numbers for deltas are in
P3.3.6.

#### P3.3.3 What is kept, and where the student finds it

One kind of thing is kept: a **version**, the bytes of one file at one moment, with a reason.
Versions belong to the **record** of a file. A record is **living** (it names the place of a current
file, P4.3) or **in the Trash** (its file was deleted or replaced there; the record keeps where it
was). The Trash is a view of the records in the Trash, grouped by the command that put them there:
an **item** is one deleted file or folder, or one replaced file. Restoring a record in the Trash
writes its newest version, its **copy**. Two cases are allowed and harmless: a living record whose
file was removed outside the Files panel (a new file there continues it, P3.3.5), and a record in
the Trash whose file still exists (a page closed during a delete, P3.3.4). N3's model test
generates both.

| Reason | Shown as | Kept |
|---|---|---|
| `saved` | `Saved` | after every Save, Save As and Auto Save (before assembling), with the bytes written, from `DocumentService.onWritten` (P4.4) |
| `opened` | `As opened` | when a document is opened, with the bytes read |
| `before-import` | `Before import` | before an import, a drop or a `From this computer...` copy replaces the file (P3.2.4) |
| `before-restore` | `Before restore` | before Earlier Versions' `Restore` writes over the file |
| `before-replace` | `Before replace` | before a Replace (Move, Copy, Restore from the Trash) writes over the file; the record then goes to the Trash as `Replaced` |
| `before-delete` | `Before delete` | before Delete in the Files panel removes the file; the record then goes to the Trash as `Deleted` |

The first three are **automatic** and kept only for a file that gets versions: not an `.L68` or
`.S68` (any letter case: Assemble makes them again), at most 1 MB, no zero byte in its first 8,192
bytes (not text), not below a folder named `.git` (any letter case), not in `/memory` (`untracked`,
P4.4). The last three are kept by the command that is about to remove or overwrite the file
(P3.3.4). `before-replace` and `before-delete` become the copy of a record in the Trash and are
kept for any file of at most 20 MB, listings and pictures included, because the student chose to
delete or replace it and may want it back the same day. `before-restore` stays an earlier version of
a current file and, like every earlier version, is at most 1 MB. A version whose bytes equal its
record's newest is not stored. Nothing is kept while the `history` switch is off.

Versions come only from the document service and from the commands of this stage, never from `Vfs`
change events. A 68000 program's writes (through the cached view) are therefore never recorded, even
to a file that is open in the editor, and never trigger anything of this section.

Nothing is ever shown or asked in normal use. The history is found:

- `Earlier Versions...` in the context menu of a file in the Files panel, at the end of the editor's
  context menu (below a separator), and at the end of the Editor's File menu (below a separator;
  command `ed.file.history`);
- `Trash...` in the Files panel's strip (icon `trash`, the kit's existing icon, accessible name
  `Trash...`) and at the end of the Editor's File menu (command `app.files.trash`).

#### P3.3.4 Limits, rollover and the priority of the student's files

There is no server and no shared store: each person's history lives in their own browser (or the
desktop app's own storage), so more users cost the project nothing. The growth per person is bounded:

| Limit | Value | Reason |
|---|---|---|
| Largest file given versions | 1 MB | the largest `.X68` in `tests/corpus` and the examples that a person wrote is 46 kB; the one larger file (`GFX.X68`, 2.4 MB) is generated data |
| Largest copy in the Trash | 20 MB per file | a course's PDF or picture fits; a larger file would take most of the Trash. Every other version, `before-restore` included, is at most 1 MB |
| Versions per living record | at most 200 | the schedule below alone could keep up to 10 + 288 + 144 + 53 = 495; the cap with the widening rule is what bounds a file; fully widened the schedule keeps at most 10 + 24 + 36 + 53 = 123 |
| Thinning schedule | the newest 10 versions always; younger than 1 day: the newest in each 5-minute slot; 1 to 7 days: the newest in each hour; 7 to 60 days: the newest in each day; older than 60 days: dropped, except the newest version of each living record | an assignment is written in bursts; what a student wants back is "how it was before I broke it tonight" (minutes) or "the version that worked last week" (days) |
| When a record exceeds 200 | the 5-minute slots widen to 15, 30, 60 minutes; then the hourly slots to 2 and 4 hours; then the oldest is dropped (a guard: fully widened the schedule stays below 200) | a burst never pushes out older days |
| Trash | an item stays at most 30 days | long enough for the end of a course week |
| Budget | `B = min(64 MB, 10 % of estimate().quota)`, 64 MB where there is no estimate: `B / 2` for the copies of the records in the Trash ("Trash"), `B / 2` for every other version ("earlier versions") | 32 MB holds about 15,000 compressed versions of a typical source (P3.3.6); the halves never take room from each other: a save never removes a Trash item, and a delete never removes an earlier version |
| Storage tight | `quota - usage` below 32 MB | the student's files must keep room to be saved |

Each record counts 128 bytes, and each version its content's stored size plus 128 bytes, also when
another version names the same content, so the counted total is never below what is stored. The
copy of a record in the Trash, and the record itself, count in the Trash half; every other version
and every living record count in the versions half. So a record that goes into the Trash moves only
its copy (and its 128 bytes) into the Trash half, and its older versions stay earlier versions; a
record that becomes living again moves its copy back, as a version like any other.

**Admission, inside the write.** Every change of the history is one IndexedDB read-write transaction
(P3.3.5). In it, each half that the change makes larger is checked against `B / 2`; when the change
would take it above `B / 2`, that half is pruned in the same transaction, down to `0.9 x B / 2` (at
most once per tenth of the half), in its own order:

- earlier versions: (1) the widened schedule (60-minute and 4-hour slots) on every living record;
  (2) then the oldest versions of the half, of any record. A living record whose last version goes
  is deleted with it.
- Trash: the oldest item first, whole.

Pruning never removes what the change itself keeps or moves, nor an item that a restore in progress
in this window is taking files from. What a change adds to the versions half is admitted only if it
is at most 1 MB. What does not fit after pruning (a version above 1 MB in the versions half, a copy
or an item above `B / 2` in the Trash) is **not kept**: for a copy that guard makes, the transaction
writes nothing; for a copy that moves back with its record, that version is dropped and the record
still becomes living (its bytes are those of the current file, so nothing is lost). IndexedDB runs
overlapping read-write transactions of an origin one after the other, so two windows never pass the
check with the same totals. A history transaction that fails with `QuotaExceededError` is not kept
and makes the state `tight`.

**The guard.** Delete, Replace, Earlier Versions' `Restore` and Undo of a Copy remove or overwrite a
current file only through `ctx.history.guard(path, how, act, confirm)` (P4.4), `how` being
`delete`, `replace` or `restore`:

1. The current bytes of the file, or of every file below the folder `path` with the names of its
   empty folders, are read through the `Vfs` with their modification times and sizes (`seen`),
   hashed and compressed (phase 1, P3.3.5). A path that does not exist gives an empty `seen`:
   nothing is kept and nothing asked, and `act(seen)` is called (`kept`, without an item). A path
   below a folder named `.git` (any letter case) rejects without calling `act`; the Files panel never
   passes one (P3.2.2, P3.2.4).
2. One transaction keeps each file's bytes as a version of its living record (`before-<how>`; a file
   without a record gets one) and, for `delete` and `replace`, puts these records, and one for each
   empty folder, into the Trash as one item, the kept bytes becoming each record's copy.
3. Not kept: `confirm()` is called. `false`: nothing is done (`declined`). `true`: `act(seen)`;
   then the records that step 2 would have put into the Trash are dropped with their versions, so
   that no older version of a file that is gone stays hidden or passes to a new file at its place
   (`not-kept`). For `restore` step 2 puts no record into the Trash, so the record and its versions
   stay.
4. Kept: `act(seen)`, the removal or the write. `act` removes or overwrites only files whose
   modification time and size are still the ones `seen` gives; for `replace` and `restore` a file
   that changed meanwhile is not written, and `act` rejects with `"prog.X68" changed while it was
   being replaced. It was not replaced.` (`... being restored. It was not restored.`). Then, whether
   `act` resolved or rejected, one transaction gives each record of the item whose file `act` did
   not remove or overwrite its place back (unless a living record has taken it meanwhile), and a
   rejection is passed on; a file that was removed or overwritten stays in the Trash (`kept`, with
   the item's id).

A page closed between 2 and 4 leaves an item in the Trash for a file that still exists; nothing is
lost, and the file's next save starts a new record. For each file of a command the order is fixed:
the open-document check, the command's question, `guard`, then what follows the write (a reload).
`guard` never runs for a file that is skipped or cancelled.

**When nothing can be kept, one answer.** An automatic version that is not kept is left out, and
nothing is said: the save, open or import goes on as today. A copy is not kept when the switch is
off, storage is tight, the history is unavailable (P3.3.7), the file is above 20 MB, or admission
finds no room (for `restore`, also a file above 1 MB); then `confirm` asks once (`messageBox`,
titled with the command, `warning`, `Yes`, `No`; No has the focus) `EASy68K cannot keep a copy of
<what>. <Do it> anyway? This cannot be undone.`, built by `cannotKeepQuestion` of
`core/history/texts.ts` (N0 > N3, P5):

| Command | `<what>` | `<Do it>` |
|---|---|---|
| Delete | `"prog.X68" in the Trash` (a folder: `the folder "demo" in the Trash`) | `Delete it` |
| Replace | `the current "prog.X68"` | `Replace it` |
| Earlier Versions' `Restore` | `the current "prog.X68"` | `Restore the earlier version` |
| Undo of a Copy | `"prog.X68" in the Trash` | `Remove the copy` |

`No` leaves the file as it is. One rule for every command's own question (Delete P3.2.2, Replace
P3.2.4, Restore from the Trash P3.3.8): where it promises the Trash, it says `This cannot be undone.`
instead when `ctx.history.state()` is not `ready` (or there is no `ctx.history`), and `confirm` then
answers `Yes` without asking, so that one file is asked about once.

An import's keep (`record(path, bytes, 'before-import', time)`, for Import Files, Import Folder, a
`.zip`, a drop and a `From this computer...` copy) is automatic: the import passes the current
bytes, does not wait, and replaces the file after its own question, as today.

Rollover runs automatically and silently:

- **After each kept version**, for that record only: the schedule and the cap. It reads at most 201
  version records of one key range: a cost that does not depend on the size of the history.
- **The global pass**, at start (10 s after the window opens) and every 10 minutes while the page is
  visible (`Scheduler.setTimer`): drops items older than 30 days and versions older than 60 days
  (except each living record's newest), and prunes a half that is above `B / 2` (`B` fell with the
  quota), in transactions of at most 500 records, a record always with all its versions. One window
  at a time runs it (Web Lock `easy68k.history.pass`, `ifAvailable: true`; a window that does not get
  it skips the pass); without Web Locks every window runs it, which is only repeated work. It runs in
  every state except `unavailable`.
- **Never in the path of a save.** A save writes the file exactly as today; the version is taken
  afterwards from `DocumentService.onWritten`, in a queued task that the save never awaits.

`estimate()` is read in phase 1 of every change and at each global pass; it gives `B` and the
`tight` state that `state()` returns. When storage is tight, history gives way: nothing new is kept
(`state()` is `tight`), and the first global pass after storage became tight lowers each half to
half of what it holds, in its order; it does so again only after a pass has seen free space above
64 MB and storage has become tight again (`meta.notice.armed`, set by such a pass and cleared by
the lowering, which writes `meta.notice.halvedAt`). `features/history` (N4) shows, once per window
when `state()` becomes `tight`, a toast that stays until dismissed: `The browser's storage for this
site is nearly full. To keep room for your files, EASy68K keeps no new earlier versions or Trash
items until there is room again, and removes its oldest ones.` This is the only notice the history
ever shows; a window shows it again only after it has seen free space above 64 MB and a second
shortage.

**Worst case.** Each half stays at or below `B / 2` counted bytes after any operation completes, in
any number of windows: at most **64 MB** together, records and versions included; the stored bytes are at most
the counted ones. A typical student with 30 source files, 40 kept versions each, about 2 kB each
after compression: about **2.4 MB**. The browser's own storage may be larger until it compacts
(Chromium's IndexedDB keeps deleted data until then). N3's stress test reports the measured ratio of
usage growth to counted bytes (P5 N3); if it is above 2, `B` is divided by that ratio.

#### P3.3.5 How it is stored, so that cost does not grow with use

IndexedDB database `easy68k-history`, separate from the files' database `easy68k-files` (so that the
files' database never needs a version change, which would close it in windows of an older version:
`db.onversionchange` in `fs/browser-backend.ts`). Its IndexedDB version is 1 for good: a later format
is a database of another name that reads this one, so no window ever meets a database it cannot read.

| Store | Key | Value | Notes |
|---|---|---|---|
| `meta` | `'totals'`, `'notice'` | `{ versions, trash }` (counted bytes of each half); `{ armed, halvedAt? }` (absent = armed) | `totals` changes in the transaction of every change |
| `roots` | `rootId` (random) | `{ handle, name }` | an opened folder's `FileSystemDirectoryHandle`, found again with `isSameEntry` |
| `files` | `fileId` (random) | `{ place, live?, spelling, newestSeq, newestHash, count, bytes, dir?, trash?: { item, at, cause, path } }` | a record. `live` equals `place` and exists only while it is living: the unique index `byLive` makes two living records of one place impossible. `trash` exists only in the Trash (`cause` `'deleted'` or `'replaced'`, `path` the item's path); indexes `byItem` (`trash.item`) and `byTrashed` (`trash.at`). `bytes`: the counted size of the record and its versions. `dir: true`: an empty folder of a deleted folder, without versions, only in the Trash: it is deleted when a restore creates its folder, and is never living |
| `versions` | `[fileId, seq]` | `{ time, hash, size, reason }` | indexes `byTime`, `byHash` |
| `contents` | `hash` (SHA-256 of the uncompressed bytes, 64 hex digits) | `{ enc, data, size, stored }` | `enc` `'deflate-raw'` or `'none'`; written with the first version that names it, deleted in the transaction that deletes the last one (`byHash` counts none) |

Every change has two phases. (1) Outside any transaction: the place is resolved (for `/folder`, the
`rootId` with `isSameEntry`), the bytes are read (for `guard`, through the `Vfs`, at most `B / 2`),
hashed with SHA-256 and compressed. (2) One read-write transaction over `files`, `versions`,
`contents` and `meta` that issues only IndexedDB requests and awaits nothing else: find the living
record through `byLive`; store no version if the bytes equal its `newestHash`; read `meta.totals`;
admission (P3.3.4); put the content if its hash is new; put the version; update the record and
`totals`. Its cost is the hash and compression of the file and a fixed number of record operations,
**independent of how many versions or files exist**; pruning, at most once per tenth of a half, adds
operations bounded by `B`. Since a version, its content and the totals change together, no content
is ever left without a version, and the totals stay right with several windows open.

A record changes its state or its place only in these transactions:

- `moved(from, to)` (a move or rename in the Files panel): each living record at or below `from`
  takes the place below `to`, and its `spelling` the new spelling, so a file's history follows it;
  when `from` and `to` give the same place (a change of letter case in the browser store), only the
  `spelling` changes;
- `guard` with `delete` or `replace`: into the Trash, and back to living for each file that `act`
  did not remove or overwrite (P3.3.4);
- a restore from the Trash, after each file is written: the record becomes living at the place
  written, its copy moving back to the versions half by admission (P3.3.4), and a `dir` record is
  deleted when its folder is created. A record is changed only while its `trash.item` is still the
  item the restore read; one that has left that item meanwhile (restored, dropped, or back in the
  Trash as another item, in another window) is not changed, and the file stays written;
- dropping (`Delete for Good`, `Empty Trash`, expiry, pruning, the lowering when storage is tight,
  `Delete Earlier Versions`, a `Yes` without a copy): the record is deleted with all its versions and
  every content no other version names (`Delete Earlier Versions` drops every version counted in
  the versions half and keeps each Trash record's copy).

When `moved` or a restore gives a place that another living record already holds (its file was
removed by something else), that record goes to the Trash first as `Replaced`, its newest version as
its copy. A record whose file is no longer at its place (a program, another application, Git or a
1.0 window removed it) otherwise stays living; a new file there continues its history, as a history
kept by path does.

Content addressing stores identical content once: the same file in two folders, a restore of an
earlier version, a copy kept before a delete of a file whose content was saved; a save that changes
nothing stores no version at all, and a move or rename stores nothing. Room for deltas later: a version names
only a hash, so a later format may store some contents as `{ enc: 'delta', base: <hash>, data }`
without touching `versions` or `files`.

The connection closes on `versionchange` and opens again on the next call, so that `deleteAll` is not
blocked by another window. An open that does not succeed within 5 s makes the state `unavailable` for
that window. `record()` calls wait in a queue of at most 16 MB; a new entry beyond that drops the
oldest waiting ones.

#### P3.3.6 Compression and deltas, measured

Measured for this design on the project's own sources with Node's `zlib` raw deflate at level 6 (the
algorithm of `CompressionStream('deflate-raw')`), on the 62 `.X68` files of `tests/corpus` and
`app/public/examples`:

- Compression of whole files: median ratio **3.8**, 10th percentile 2.6, 90th percentile 8.3; the ten
  examples of `app/public/examples` together 53,478 bytes to 15,171 (ratio 3.5).
- A history of 50 successive versions of eight sources of 5 to 11 kB each (one to three small edits per
  version: a changed line, an inserted line, a removed line): raw 3,018,985 bytes; **whole compressed
  versions 631,112 bytes (about 77 kB per file)**; a delta against the previous version (common start
  and end removed, the middle compressed) 111,090 bytes (about 14 kB per file); deflate with the
  previous version as preset dictionary 55,575 bytes (about 7 kB per file).

So deltas would store 6 to 11 times less for such histories. They are **not** adopted in this stage,
because the limits make the absolute sizes small without them (77 kB for 50 versions of a file;
2.4 MB for a typical student; 64 MB at most), while deltas cost: reading a version means applying a
chain; one damaged record loses every version behind it; pruning by the thinning schedule removes
links from the middle of chains, which means re-basing; and every one of these paths needs tests. The
synthetic edits above are smaller than real ones, which favours deltas; real edits narrow the gap.
The layout leaves room for them (P3.3.5). If the stress test of N3 shows a student's typical history
above 16 MB, deltas against the previous kept version become the next step (D4).

`CompressionStream('deflate-raw')` exists in Chromium 103 and later, Safari 16.4 and later, Firefox
113 and later, Electron of the desktop app, and Node 24 (the project's Node). Where it does not
exist, contents are stored with `enc: 'none'` and count against the budget at their full size.

#### P3.3.7 Disposable by design

- History and Trash are a separate database. Clearing either, deleting the database, or losing it
  never touches a current file.
- A single record that does not parse is skipped and counted, and the dialogs say above their list
  `<n> entries could not be read.`; the rest stays usable. A database that fails to open, or a `meta`
  record that does not parse, makes the history unavailable in that window: the dialogs say `The
  history cannot be read (<detail>). Your files are not affected.` with the button `Delete History
  and Trash` (confirmation `Delete all earlier versions and everything in the Trash for good? Your
  current files are not affected.`, `Yes`, `No`), which deletes the database with
  `indexedDB.deleteDatabase`. Delete, Replace and Restore still work then, after saying that they
  cannot be undone (P3.3.4). What each member of the service does in each state is the table of
  P4.4.
- Clearing the site's data in the browser removes My Programs and the history together; the Storage
  group of P3.5 says so: `Clearing this site's data in the browser removes My Programs, earlier
  versions and the Trash.`
- The figure of what is used is in the Files panel's line (P3.2.6) and in P3.5, with `Empty Trash`
  and `Delete Earlier Versions` buttons there.

#### P3.3.8 The dialogs

**Earlier Versions** (`history.versions`, modal). Title `Earlier Versions of prog.X68`.

```
+-- Earlier Versions of prog.X68 --------------------------------------------------+
| Kept                | Size    | Kind                                                |
| 21 Nov 2026 21:42   | 7.3 kB  | Saved                                               |
| 21 Nov 2026 21:37   | 7.2 kB  | Saved                                               |
| 14 Nov 2026 18:05   | 6.9 kB  | As opened                                           |
+-----------------------------------------------------------------------------------+
| [ comparison of the selected version (left) with the file now (right) ]            |
+-----------------------------------------------------------------------------------+
|        [Restore] [Open as New Document]                              [Close]       |
+-----------------------------------------------------------------------------------+
```

- The list is the kit's `DataGrid`, newest first; dates in the system's locale with
  `Intl.DateTimeFormat`, minutes resolution. Kinds: the `Shown as` column of P3.3.3.
- The comparison is `@codemirror/merge`'s `MergeView`, both sides `EditorState.readOnly.of(true)`,
  decoded with `core/codec/cp1252.ts` and `core/documents/format.ts` `decodeFile` (the trailer lines
  are shown as they are in the file), headed `<date of the version>` and `Now`. Below 700 px of dialog
  width it is the unified view of the same package, with `mergeControls: false`. It uses the editor's
  font (`ui/editor/fonts.ts`) and the theme tokens for inserted (`--c-ok` at 15 %) and deleted
  (`--c-danger` at 15 %) lines. The package's own gutter is off (`gutter: false`); N4's own gutter
  marks each inserted line `+` and each deleted line `-`, so that nothing depends on colour alone.
- `Restore`, in this order: if the file is open in the editor and modified: `"prog.X68" has changes
  that are not saved. Save it or close it first, then restore.` (`Restore`, `information`, `OK`) and
  nothing happens; otherwise the version's bytes are read (`read(path, seq)`; a version that is no
  longer kept, pruned since the list was shown: `This version is no longer kept.`, `Restore`,
  `information`, `OK`, and the list is read again), then `guard(path,
  'restore', write, confirm)` (P3.3.4) keeps the current content as `Before restore`, or asks the
  question of P3.3.4, and writes the bytes; then an open, unmodified document is reloaded
  (`DocumentService.reload`). Another window that has the file open learns of it from the reload
  offer of P3.3.10.
- `Open as New Document` opens a new untitled source document with the version's text (the
  student can then copy what they need).
- Empty states, in place of the list: `No earlier versions are kept for this file yet. A version is
  kept each time you save it.` / `Earlier versions are not kept for listing and S-record files:
  Assemble makes them again.` / `Earlier versions are not kept for files larger than 1 MB or for
  files that are not text.` / `Earlier versions are not kept for files in a .git folder.` (by the
  reason of `untracked`, P4.4). When the file has versions but gets no new ones, the matching
  sentence of these stands above the list.
- With the `history` switch off, a line above the list: `Keeping earlier versions is switched off
  (Options > Port Additions...). Versions kept before are listed below.` The list is shown whenever
  versions exist; with none, the line stands alone.
- A version from another window appears in the list while it is open (BroadcastChannel
  `easy68k.history`, message `{ kind: 'changed', places: [...] }`).

**Trash** (`history.trash`, modal). Title `Trash`. `DataGrid` columns `Name`, `Was in`, `Why`
(`Deleted` or `Replaced`, from the item's `cause`), `When`, `Size`; several rows can be selected (the
grid's `multiSelect`, with the Shift and Ctrl rules of P3.2.1 and the keys of P1.3). Buttons
`Restore`, `Delete for Good`, `Empty Trash`, `Close`.

- `Restore` puts each selected item back at its place, through `restoreWithQuestions`
  (`core/trash-restore`, P4.4), which calls `ctx.history.restoreTrash` with the questions below; the
  Files panel's Undo of a delete uses the same function. For each file, in the fixed order of P3.3.4:
  first the open-document check below, then, if something is there: `"demo/prog.X68" exists. Replace
  it with the one from the Trash? The file there now goes to the Trash. Choose No to keep both: the
  restored file is named "prog (restored).X68".` (`Yes`, `No`, `Cancel`; further names `prog
  (restored 2).X68` ...); when `ctx.history.state()` is not `ready`, its second sentence is `This
  cannot be undone.` (P3.3.4). `Yes` writes through `guard(path, 'replace', ...)`: the file there
  goes to the Trash as `Replaced`, or the question of P3.3.4 is asked. `Cancel` stops: files already
  written stay restored, and the item keeps the others.
- If a file to be written is open in this window's editor: modified - that file is skipped with
  `"prog.X68" has changes that are not saved. Save it or close it first, then restore.` (`Restore`,
  `information`, `OK`), and it stays in the Trash; not modified - the document is reloaded
  (`DocumentService.reload`) after the write.
- If its store is not available: an opened folder that is not open now: `"prog.X68" was in the
  folder "Lab", which is not open. Restore it into My Programs/Restored instead? Choose No to leave it
  in the Trash.`; the desktop app's disk outside a granted root: `"prog.X68" was in "<path>", which
  EASy68K cannot reach now. Restore it into My Programs/Restored instead? Choose No to leave it in the
  Trash.` (`Yes`, `No`). (Linked files are never in the Trash: they are removed from the list, not
  deleted, P3.2.2.)
- The item is read once, at the start, with the bytes of its files. If it is no longer in the Trash
  then (restored or dropped in another window), nothing is written and `restoreWithQuestions` shows
  P3.2.7's `it is no longer in the Trash` text. Each written file leaves the Trash at once (P3.3.5),
  and the item's empty folders are created with its last file. A `Cancel`, a skip, a `No` or a failed
  write leave the files not yet written in the Trash, and the files already written stay restored.
- A restore that wrote some of an item's files but not all ends with the message (`Restore` or
  `Undo`, `information`, `OK`): `2 of 5 files were restored. The others are still in the Trash.`;
  when some of the files not written are no longer in the Trash at the end (`lost`: dropped or
  expired meanwhile, in another window), the second sentence is `1 of the others is no longer in the
  Trash.` (`<n> of the others are no longer in the Trash.`), and when none of them is, `The others
  are no longer in the Trash.`
- `Size` and the figure of `Empty Trash` are `TrashItemInfo.bytes` (P4.4).
- `Delete for Good` asks `Delete the 2 selected items for good?` (`Yes`, `No`).
- `Empty Trash` asks `Delete everything in the Trash for good? (12 items, 1.4 MB)` (`Yes`, `No`) and
  deletes the items listed.
- Empty state: `The Trash is empty. Files you delete in the Files panel stay here for up to 30 days;
  when the Trash is full, the oldest go first.`

When a dialog closes and the element that opened it no longer exists (a deleted row), the focus goes
to the Files tree's focused row, else to the Editor panel.

#### P3.3.9 Undo, in terms of the store

Undo of a delete calls `restoreWithQuestions` for its items (P3.3.8, with its questions); undo of a
move or rename moves back and calls `moved` back; undo of a copy deletes each copy through `guard`
(P3.2.7); undo of a Move or Copy that replaced files then restores their `Replaced` items (P3.2.7).
The undo stack (P3.2.7) holds, for a delete, each item's id with its path; for a move or rename, path
pairs; for a copy, each copy's path; for a replace, the ids of the `Replaced` items that `guard`
returned; not bytes.

#### P3.3.10 Folders that are Git repositories

Students who want Git use it on an opened folder of their disk with their own tools. Checked against
the code:

- **Changes Git makes underneath**: the simulator's cached view revalidates an opened folder before a
  run from idle and after the window had the focus elsewhere (main §3.8.4, `CachedSyncFiles.revalidate`);
  Save compares the stored modification time and asks the question of main §3.8.6 rule 3. Not covered
  today, and added: the Files tree re-lists its expanded folders of `/folder` (and `/disk`) when the
  window regains the focus (N5); and an open, unmodified document whose file's modification time
  differs from the one the document recorded (`DocumentService.fileTime`) is offered a reload when
  the window regains the focus or receives an external change of its path, in every store (N8): toast
  `"prog.X68" was changed outside this window.` with the action `Reload` (`DocumentService.reload`).
  A modified document is left alone (its Save asks).
- **`.git` and memory** (found while designing): `CachedSyncFiles.prepare` loads the whole tree below a
  program's folder into memory up to `DEFAULT_SNAPSHOT_LIMITS` (2,000 files, 32 MB per file, 256 MB,
  depth 4), and so does `Vfs.snapshot` for the assembler's second pass. In a repository, `.git` holds
  many files: they are loaded and can push real files of the program beyond the limits, each such
  file named in the message area. N8 changes the order and the messages, not what a program may
  reach: files below a folder named `.git` (any letter case) are taken **after** all other files,
  with the same limits; while everything fits, the set of files loaded is exactly today's. Files of
  `.git` left out by the limits are not named in `Not available to the program: ...`. A program that
  opens a file in `.git` still gets it while it fits, as in the original. The desktop app reads the
  disk directly and is unchanged.
- No command of this stage writes, deletes, moves or copies anything below a `.git` folder (P1.1 rule
  2; Save, Import and a program's own file operations are unchanged there, and `cached.ts` and
  `vfs.ts` gain no write guard for `.git`): the Files panel does not list `.git` (P3.2.5), refuses to delete, move, copy or rename a folder
  that holds one (P3.2.2, P3.2.4), leaves it out of exports (P3.2.3), and the Trash never stores it
  (P3.3.1 property 7; `guard` rejects a path below `.git` and is never called for one, because the
  Files panel neither lists nor accepts one, P3.3.4, P3.2.2, P3.2.4).

### P3.4 Files that are not text

#### P3.4.1 What opens where

When `viewer` is on and a file is opened in Editor mode (Files panel, `Open File...`, a drop, a
start-up argument), `DocumentService.open` asks the viewer first (P4.4):

| File | Shown as |
|---|---|
| `.X68`, `.L68`, `.S68` (any letter case) | text, always, as in the original |
| `.pdf` | the PDF viewer |
| `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.webp`, `.svg`, `.ico` | the picture viewer |
| any other file with a zero byte in its first 8,192 bytes | the notice |
| anything else | text, as today |

With `viewer` off, every file opens as text. Simulator mode's `Open...` (`.S68`) and EASyBIN are not
affected.

#### P3.4.2 The viewer

A viewer is a transient dock panel `viewer:<n>` (P3.1.2) opened with `openTransient` as a tab of the
group that holds `editor`; its tab is the file's name, its tool-tip the place text (P4.5). A second
open of the same path selects its tab (`selectTransient`). Its strip: the name, the size, `Open as
Text` (opens the file as a document with `ctx.documents.open(path, { asText: true })`, as with
`viewer` off, and closes the viewer), `Export` (web: downloads the file; desktop app: not shown), and
for pictures one toggle button `Actual Size` with `aria-pressed` (pressed: 1:1; not pressed: scaled
to fit). Viewers are not part of the stored arrangement: after a reload they are closed. They are
not documents: the Window menu does not list them, Save and Assemble do not act on them. A file
opened before the dock is mounted (a start-up argument, `?open=`, the desktop app's open-file
event) is shown once the Editor dock attaches: `openTransient` queues it (P4.4). Without a dock that
accepts transient panels (`acceptsTransient()` false: N0's stub, tests), `wants()` returns false and
every file opens as text.

- **Picture**: `<img src="blob:...">` with `alt` = the file's name, centred on `--c-surface`, scaled
  to fit (default) or at 1:1 with scroll bars. The blob's type is that of the extension: `image/png`,
  `image/jpeg` (`.jpg`, `.jpeg`), `image/gif`, `image/bmp`, `image/webp`, `image/svg+xml`,
  `image/x-icon`. Only an `<img>` ever references a picture blob. An image that fails to decode shows
  the notice.
- **PDF**: an `iframe` with `src` = a `blob:` URL of the bytes with type `application/pdf` and
  `title="PDF: report.pdf"`, filling the panel. When `navigator.pdfViewerEnabled` is `false` (the
  browser downloads PDFs instead of showing them), the viewer shows the notice below with `Export`
  instead of the frame. The browser's own PDF viewer draws it (Chromium, Edge,
  Safari, Firefox; the desktop app with Electron's PDF viewer, P5 N0). The iframe has no `sandbox`
  attribute, because a sandboxed frame blocks the built-in PDF viewer; its `src` is only ever a
  `blob:` URL the viewer created with type `application/pdf`. Under the strip a line: `If the PDF
  does not appear, use Export and open it with another program.` (desktop: `If the PDF does not
  appear, open it from its folder with another program.`) The `blob:` URL is revoked when the viewer
  closes.
- **Notice** (other non-text files): the text `"data.bin" does not look like text. Opened as text, it
  will probably look like nonsense.` and the buttons `Open as Text` and `Export`. For a PDF where
  the browser shows none: `"report.pdf" cannot be shown here because this browser does not show PDF
  files.` with the same buttons.
- No viewer blob is ever opened in a new window, a link, or a frame other than this one. `Export`
  always uses the type `application/octet-stream`.
- The bytes are read once when the viewer opens; a later change of the file is not followed (`Open`
  again shows it).

CSP: `img-src` already allows `blob:`. `frame-src 'self'` becomes `frame-src 'self' blob:` (N0
changes `tools/vite-csp-plugin.mjs` and `CONTENT_SECURITY_POLICY` in `desktop/src/security.ts`). The
page creates `blob:` URLs only from bytes it read, with the explicit types above, so no HTML document
can be put into a frame this way; Chromium does not sniff a `blob:` with an explicit type. Offline and
under a sub-path: `blob:` URLs are local to the page.

A `blob:` document inherits the policy of the page that made it, and the policy has `default-src
'none'`, so `object-src` is `'none'` inside the frame, and `script-src` (`'self' 'wasm-unsafe-eval'`,
without `'unsafe-inline'` or `blob:`) lets no script of such a document run, even if its bytes were
HTML. Whether the built-in PDF viewers still draw
there is checked by a person before N6 starts (N0's spike, P5 N0). If one does not, R4 applies.

What only a person can check (added to `docs/MANUAL-TEST-MAC.md` and the manual list of main §6.8):
a PDF appears under the production CSP in Chrome and Edge on macOS and Windows, Safari, and the
desktop app. Automation checks that the iframe exists with a `blob:` of type `application/pdf`
holding the file's bytes, because headless browsers do not run the PDF viewer.

### P3.5 `Options > Port Additions...`

Command `app.additions.options`, caption `Port Ad&ditions...`, at the end of the Editor's Options
menu and the Simulator's Options menu, after `Import/Export Settings...` (Editor) / `Execution
Speed...` (Simulator), below a separator. Modal dialog `plus.options`, title `Port Additions`:

```
+-- Port Additions ---------------------------------------------------------------+
| [x] &Show PDF files and pictures in a viewer instead of as text                   |
| [x] &Keep earlier versions of saved files and a Trash for deleted files           |
| -- Storage ---------------------------------------------------------------------  |
|   My Programs:                     37 files, 3.4 MB                               |
|   Earlier versions:                212 versions, 0.9 MB                           |
|   Trash:                           4 items, 0.3 MB                                |
|   This site uses 7.9 MB in this browser, about 1.8 GB free                        |
|   Clearing this site's data in the browser removes My Programs, earlier          |
|   versions and the Trash.                                                         |
|   [Empty Trash]  [Delete Earlier Versions]                                        |
|                                                            [  OK  ] [ Cancel ]   |
+-----------------------------------------------------------------------------------+
```

- The two boxes are `AppSettings.plus.viewer` and `.history` (P4.2); OK stores them, Cancel does not.
- With the argument `{ group: 'storage' }` the dialog opens with the focus on `Empty Trash`.
- Switching `history` off does not delete what is kept, except that a file deleted or replaced
  while it is off takes its earlier versions with it after the question of P3.3.4; the two buttons
  do (`Delete Earlier Versions`
  asks `Delete all earlier versions of all files for good? Your current files are not affected.`).
  The buttons act at once, not on OK.
- Desktop app: the last two lines of the group are `Earlier versions and Trash are kept in the app's
  own storage.`; "My Programs" is shown when the browser store exists there.

### P3.6 All new commands

| id | Caption | Mode (from the prefix) | Kind | Argument | Enabled | Menu place | Keys | Owner of the handler |
|---|---|---|---|---|---|---|---|---|
| `app.layout.move` | `Mo&ve Panel To...` | app | action | `{ panel?: string }` | P3.1.4 | Editor Window, Simulator View (P3.1.4) | - | N1 |
| `app.layout.lock` | `Loc&k Layout` | app | check | - | P3.1.4 | same | - | N1 |
| `app.layout.reset` | `R&eset Layout` / `Reset La&yout` | app | action | - | P3.1.4 | same | - | N1 |
| `ed.window.splitRight` | `Split Editor &Right` | editor | action | - | P3.1.4 | Editor Window | - | N2 |
| `ed.window.splitDown` | `Split Editor &Down` | editor | action | - | P3.1.4 | Editor Window | - | N2 |
| `ed.window.unsplit` | `Close &Split` | editor | action | - | P3.1.4 | Editor Window | - | N2 |
| `ed.file.history` | `Earlier &Versions...` | editor | action | `{ path?: VPath }` (default: the active document's path) | `ctx.history` exists and the path is a file outside `/memory` | end of the Editor's File menu below a separator; end of the editor's context menu below a separator | - | N4 |
| `app.files.trash` | `Tras&h...` | app | action | - | `ctx.history` exists (in state `unavailable` the dialog shows the text of P3.3.7) | end of the Editor's File menu, after `Earlier Versions...` | - | N4 |
| `app.additions.options` | `Port Ad&ditions...` | app | action | `{ group?: 'storage' }` | always | end of the Options menus (P3.5) | - | N7 |

Access keys checked against each menu: Editor File (`N O S A P l x` used; `V`, `h` free), Editor
Window (`A C H T M` used, and the digits of the document list; `v R D S k e` free), Editor Options
(`A E` used; the `Import/Export Settings...` item has none; `A` would clash, so the caption is `Port
Ad&ditions...`), Simulator View (`O M S H B E L` used; `v k y` free), Simulator Options (`L E A F B
S W` used; `d` free: `Port Ad&ditions...` there too). `menus.test.ts` (W3) gains a test that no item
added by this stage shares its access key with any other item of its menu, and that every original
caption is unchanged. Duplicates among the original items (the Edit menu's `&Redo` and `Find And
&Replace...`; the editor context menu's `&Redo` and `&Reload File`) are kept as they are.

The macOS native menu (`commands/native-menu.ts`) shows the items in the same places; none has an
accelerator.

---

## P4. Data and contracts

### P4.1 Stored things, at a glance

| What | Where | Format | Limits | Migration | Cleared with the site's data |
|---|---|---|---|---|---|
| Dock arrangement per mode, lock | `localStorage` `easy68k.settings.v1`, `app.layout.dock` (per window, erratum W3 16) | P4.2 | a few kB | absent = the default arrangement, sized from `layout.splits` (P3.1.3) | yes |
| The two switches | same document, `app.plus` (shared by all windows, stamped per setting) | P4.2 | - | absent = defaults | yes |
| Records, versions, contents, folder roots (the Trash is the records in it) | IndexedDB `easy68k-history` | P3.3.5 | P3.3.4 | new; a later format is a database of another name (P3.3.5) | yes |
| Undo stack | memory of the window | - | 20 operations | - | lost on reload |
| Viewers' `blob:` URLs | memory | - | - | - | - |

Nothing is added to `easy68k-files`, `easy68k-linked`, `easy68k-fsaccess`, `easy68k.drafts`, the
settings files of the original, or any folder of the disk.

Mixed versions: a 1.0 window open at the same time as a Plus window keeps its own `app.layout` and
writes it whole when it changes its layout, without `dock`; the next Plus window that starts then
shows the default arrangement (accepted: nothing else is lost, and `Lock Layout` is back at its
default, on).
Going back to 1.0 leaves `easy68k-history` in place, unread and unpruned, until the site's data is
cleared.

### P4.2 Settings

Added to `app/src/contracts/settings.ts` (optional members only):

```ts
/** A stored dock arrangement (ARCHITECTURE-PLUS P3.1). Independent of the docking library's model. */
export type DockNode =
  | { type: 'row' | 'column'; weight: number; children: DockNode[] }
  | { type: 'tabs'; weight: number; panels: string[]; selected: string };

/** Where a hidden panel was, to put it back there when it is shown again. */
export interface DockParked { near: string; side: 'tab' | 'left' | 'right' | 'above' | 'below' }

export interface DockLayouts {
  version: 1;
  locked?: boolean;                                   // absent = true (D2)
  editor?: DockNode;                                  // absent = the default arrangement (P3.1.3)
  simulator?: DockNode;
  parked?: Record<string, DockParked>;                // key = panel id
}

export interface PlusSettings {
  viewer: boolean;                                    // default true (P3.4)
  history: boolean;                                   // default true (P3.3)
}

export interface AppSettings {
  // ... unchanged members ...
  layout: {
    // ... unchanged members ...
    dock?: DockLayouts;
  };
  plus?: PlusSettings;
}
```

- `core/settings/defaults.ts` is not changed: `mergeWithDefaults` keeps keys the defaults do not have
  (`core/settings/service.ts`), so both values reach `get()` as stored. They are validated where they
  are read: `readDock(settings)` in `app/src/ui/dock/stored.ts` and `readPlus(settings)` in
  `app/src/core/plus/settings.ts`, which return the default for anything malformed: a `DockNode` with
  an unknown type, a weight that is not a positive finite number, a `tabs` node without panels or
  with a `selected` it does not list, a panel id that is not a panel of that mode (P3.1.2, `viewer:`
  ids are never stored), a panel listed twice, or a mode's tree that lacks one of its panels that
  cannot be closed. The default for a mode is today's arrangement sized from `layout.splits`
  (P3.1.3).
- `app.layout` is merged and stamped as a whole (`WHOLE_SETTINGS` in `core/settings/service.ts`), so
  `dock` follows the per-window rule without a change there. `app.plus.viewer` and `app.plus.history`
  are stamped per setting like every other leaf.
- A visible panel that the stored tree does not list (it was hidden when the tree was stored) is put
  in by `parked`, else at its default place. A hidden panel listed in the tree is left out of the
  rendered model and its place written to `parked`.

### P4.3 Places (keys of the history)

`place` (P3.3.5) names a file independently of which store is mounted where:

| Path | `place` |
|---|---|
| `/browser/demo/prog.X68` | `browser:/demo/prog.x68` (letter case folded with `foldCase`, as the browser store compares; the spelling for display is the `files` record's `spelling`) |
| `/folder/<rel>` | `folder:<rootId>/<rel>` with the spelling the backend reports (`rootId` from the `roots` store, found by `isSameEntry` of the mounted folder's handle) |
| `/linked/<id>/<name>` | `linked:<id>/<name>` |
| `/disk/<path>` | `disk:/<path>` with the spelling the backend reports |
| `/memory/...` | not tracked |

Only the browser store is folded: an opened folder or the desktop disk may be on a case-sensitive
volume (a Git checkout can hold `Prog.X68` and `prog.X68`), and two files must never share one
history. On a case-insensitive volume a path reached under two spellings gets two histories, which
loses nothing.

`FolderBackend` (FS2, `fs/fsaccess-backend.ts`) gains a read-only getter `rootHandle` that returns the
handle it was made with (N3), so that `fs/history-db.ts` can find the root.

The display name of a history entry is computed from the path when shown (P4.5), never stored as a
path the student must read.

### P4.4 Contracts (additions only)

`app/src/contracts/history.ts` (new; exported from `contracts/index.ts`):

```ts
import type { Bytes } from './engine';
import type { VPath } from './fs';

export type VersionReason = 'saved' | 'opened' | 'before-import' | 'before-restore' | 'before-replace' | 'before-delete';
export interface VersionInfo { seq: number; time: number; size: number; reason: VersionReason; }
export interface TrashItemInfo {
  id: string; deletedAt: number; cause: 'deleted' | 'replaced';
  path: VPath; kind: 'file' | 'dir'; files: number;
  /** Counted bytes in the Trash half: its records and their copies (P3.3.4). */
  bytes: number;
  /** False when its store is not mounted now (P3.3.8). */
  restorableInPlace: boolean;
}
/** `versions`, `versionBytes`: the versions half; `trashItems`, `trashBytes`: the Trash half (P3.3.4). */
export interface HistoryUsage { versions: number; versionBytes: number; trashItems: number; trashBytes: number; budget: number; }
/** A file as guard read it in phase 1 (P3.3.4). */
export interface SeenFile { path: VPath; mtime: number; size: number; }
/** 'off': the `history` switch is off. 'tight': storage is nearly full. In 'off', 'tight' and
 *  'unavailable' nothing new is kept (P3.3.4). */
export type HistoryState = 'ready' | 'off' | 'tight' | 'unavailable';

export interface HistoryService {
  state(): HistoryState;
  /** Why `path` gets no automatic versions, or null when it does (P3.3.3). 'git': below a folder
   *  named .git, any letter case; 'memory': in /memory. */
  untracked(path: VPath, size: number, head: Bytes): 'generated' | 'too-large' | 'not-text' | 'git' | 'memory' | null;
  /** Keeps an automatic version (P3.3.3) unless it equals the newest; `time` is when the bytes were
   *  written or read (the version's time). Never throws; never awaited by a save or an import;
   *  queued (at most 16 MB waiting, P3.3.5). */
  record(path: VPath, data: Bytes, reason: 'saved' | 'opened' | 'before-import', time: number): Promise<void>;
  /** The only way a command of this stage removes or overwrites a current file (P3.3.4): reads the
   *  current files of `path` (for 'delete' a file or a folder) as `seen`, keeps a copy of their
   *  bytes, for 'delete' and 'replace' puts their records into the Trash as one item, then calls
   *  `act(seen)`, which touches only files of `seen` that are unchanged. When no copy can be kept,
   *  calls `act` only if `confirm()` resolves true; then, for 'delete' and 'replace' only, drops the
   *  records of the files of `seen` (P3.3.4 step 3); for 'restore' no record changes. After `act`,
   *  records of files it did not remove or overwrite go back to living, and a rejection is passed
   *  on. Rejects without calling `act` for a path below .git. `item`: the Trash item, for 'kept'
   *  with 'delete' or 'replace' when `seen` is not empty. */
  guard(
    path: VPath,
    how: 'delete' | 'replace' | 'restore',
    act: (seen: readonly SeenFile[]) => Promise<void>,
    confirm: () => Promise<boolean>,
  ): Promise<{ outcome: 'kept' | 'not-kept' | 'declined'; item?: string }>;
  versions(path: VPath): Promise<VersionInfo[]>;            // newest first
  read(path: VPath, seq: number): Promise<Bytes>;
  trashItems(): Promise<TrashItemInfo[]>;                     // newest first
  /** Writes a Trash item back through the Vfs (P3.3.8). Reads the item and its bytes once; `gone`
   *  when it is no longer in the Trash then, and nothing is written. For each file, in the order of
   *  P3.3.4: before(), ask() when the place is taken ('replace' writes through guard(..., 'replace',
   *  ..., () => confirm(path))), the write, the record back to living, after(). 'cancel', a skip, a
   *  No or a failed write leave the files not yet written in the Trash; a failed write ends the
   *  restore with its message in `error`. `left`: files not written whose records are still in the
   *  item when the restore ends; `lost`: files not written whose records are no longer there. The
   *  item's empty folders are created with its last file. */
  restoreTrash(
    id: string,
    options: {
      ask(path: VPath): Promise<'replace' | 'beside' | 'cancel'>;
      /** Asked when the item's store is not mounted; the folder to restore into, or null. */
      fallback(item: TrashItemInfo): Promise<VPath | null>;
      /** The question of P3.3.4 when no copy of a file to be replaced can be kept. */
      confirm(path: VPath): Promise<boolean>;
      /** Asked before each write; 'skip' leaves the file out (an open, modified document). */
      before?(path: VPath): Promise<'write' | 'skip'>;
      /** Called after each write (the caller reloads an open, unmodified document). */
      after?(path: VPath): Promise<void>;
    },
  ): Promise<{ restored: VPath[]; left: VPath[]; lost: VPath[]; gone: boolean; error?: string }>;
  /** Deletes the items, their records and versions (P3.3.5). */
  dropTrash(ids: readonly string[]): Promise<void>;
  /** A file, or a folder moved without a merge, of the history moved (Files panel rename or move,
   *  P3.2.4, P3.3.5). */
  moved(from: VPath, to: VPath): Promise<void>;
  /** Deletes every version of the versions half (`Delete Earlier Versions`, P3.3.5). */
  clearVersions(): Promise<void>;
  deleteAll(): Promise<void>;                                 // deletes the database
  usage(): Promise<HistoryUsage>;
  subscribe(listener: () => void): () => void;                // any change, from this window or another
}
```

What each member does in each state. No member rejects because of the history's state, so that no
file command fails because of it (`read` of a version that is gone rejects, P3.3.8, and in
`unavailable` every version is gone):

| Member | `ready` | `off`, `tight` | `unavailable` |
|---|---|---|---|
| `state`, `untracked`, `subscribe`, `deleteAll` | as stated | as stated | as stated |
| `record` | keeps (P3.3.3) | resolves, keeps nothing | resolves, keeps nothing |
| `guard` | keeps a copy, else asks (P3.3.4) | keeps nothing: asks, then step 3 | keeps nothing: asks, then `act`; no record changes |
| `moved`, `dropTrash`, `clearVersions`, the record changes of `restoreTrash`, the global pass | run | run (they keep no new bytes; a copy moving back passes admission) | resolve without effect (`restoreTrash`: `gone`) |
| `versions`, `read`, `trashItems`, `usage` | read | read | resolve `[]` (`usage`: zeros); `read` rejects; the dialogs show P3.3.7 |

`app/src/fs/history-db.ts` (N3) exports, with this signature, which N0 writes into its stub and N3
may not change:

```ts
export interface HistoryDeps {
  vfs: Vfs;
  settings: SettingsService;
  clock: Clock;
  scheduler: Scheduler;
  indexedDB: IDBFactory | null;
  IDBKeyRange: typeof IDBKeyRange | null;
  subtle: SubtleCrypto;
  compression: { CompressionStream?: typeof CompressionStream; DecompressionStream?: typeof DecompressionStream };
  locks: LockManager | null;
  channel: (name: string) => BroadcastChannel | null;
  estimate: (() => Promise<StorageEstimate>) | null;
}
/** With `indexedDB` null the service's state() is 'unavailable'. */
export function createHistoryService(deps: HistoryDeps): HistoryService;
/** The deps of the running browser or desktop app, for SERVICE_FACTORIES. */
export function browserHistoryDeps(ctx: AppContext): HistoryDeps;
```

`app/src/fs/history-memory.ts` (N0 > N3; imported only by tests and `state/testing.ts`, never by
production code, since it imports the development dependency `fake-indexeddb`) exports, with this
signature:

```ts
/** The real store of history-db.ts over a fresh fake-indexeddb IDBFactory, with fake locks and
 *  channel, Node's subtle and CompressionStream, and an estimate of `quota` (default: none, B = 64 MB). */
export function createMemoryHistoryService(deps: {
  vfs: Vfs; clock: Clock; scheduler: Scheduler; settings?: SettingsService; quota?: number;
}): HistoryService;
```

There is one implementation of the history: the memory version is `createHistoryService` itself,
so the code that N4 and N5 test against follows the same rules as the store that ships. Until N3
is merged, N0's stub returns a service whose state is `unavailable` and whose members do what the
table of states gives for it. `state/testing.ts` registers
`createHistoryService: (ctx) => createMemoryHistoryService({ vfs: ctx.vfs, clock: ctx.clock,
scheduler: ctx.scheduler, settings: ctx.settings })`.

`app/src/core/trash-restore/restore-flow.ts` (N0 > N4) holds the questions of a Trash restore once,
for the Trash dialog (N4) and the Files panel's Undo (N5), since a feature may not import another:

```ts
export interface RestoreFlowDeps {
  history: HistoryService;
  dialogs: DialogService;        // messageBox, for the texts of P3.3.8
  documents: DocumentService;    // open documents: skip when modified, reload when not
  placeShort(path: VPath): string;
}
/** Restores the items one after the other with the questions and messages of P3.3.8 and the
 *  question of P3.3.4, titled `title`; shows the no-longer-in-Trash text of P3.2.7 itself for an
 *  item that is `gone`, naming the path given with the id. */
export function restoreWithQuestions(
  deps: RestoreFlowDeps,
  items: readonly { id: string; path: VPath }[],
  title: 'Restore' | 'Undo',
): Promise<{ restored: VPath[]; left: VPath[]; lost: VPath[]; gone: VPath[] }>;
```

N0's stub calls `restoreTrash` with `ask` answering `'cancel'`, `fallback` answering `null` and
`confirm` answering `false`. Its texts are exported from `core/trash-restore/texts.ts`.

`app/src/contracts/features.ts`, `AppContext`, two optional members:

```ts
  /** ARCHITECTURE-PLUS P3.3. Absent in tests that do not need it. */
  readonly history?: HistoryService;
  /** ARCHITECTURE-PLUS P3.4. Absent in tests that do not need it. */
  readonly viewer?: ViewerService;
```

`ServiceFactories`, two optional members:

```ts
  createHistoryService?(ctx: AppContext): HistoryService;
  createViewerService?(ctx: AppContext): ViewerService;
```

with, in the same file:

```ts
export interface ViewerService {
  /** True when `path` with these bytes is to be shown by the viewer: the `viewer` switch is on, the
   *  table of P3.4.1 says so, and `dockOf(ctx).acceptsTransient()` is true. */
  wants(path: VPath, bytes: Bytes): boolean;
  /** Opens or selects the viewer of `path`; reaches the dock only through state/dock.ts, and only
   *  when called, never while the factory runs. */
  show(path: VPath, bytes: Bytes): void;
}
```

`app/src/bootstrap.ts`: `CONTEXT_KEYS` and `SERVICE_ORDER` gain `history` and `viewer`, set in that
order after `fileDialogs` and **before** `documents` (the document service's deps take `ctx.viewer`
when it is built). Each is set from its factory, or to `undefined` when the factory is absent, so
that reading it never throws. `features/index.ts`'s `SERVICE_FACTORIES` gains
`createHistoryService: (ctx) => createHistoryService(browserHistoryDeps(ctx))` and
`createViewerService` from `features/viewer/index.ts`.

`app/src/contracts/documents.ts`, `DocumentService`, additions:

```ts
  /** As before; with { asText: true } the viewer is not asked (P3.4.2, Open as Text). */
  open(path: VPath, options?: { asText?: boolean }): Promise<DocumentState | null>;

  /** The file at `from` (or a folder `from` and everything below) is now at `to`: open documents
   *  follow, with text, modified state and history unchanged; the recorded modification time is taken
   *  from the new file, and the document's draft is rewritten at once (ARCHITECTURE-PLUS P3.2.4). */
  relocate?(from: VPath, to: VPath): Promise<void>;

  /** Called after each successful write by Save, Save As and Auto Save, with the exact bytes written
   *  ('saved'), and after each open of a file as a document, with the bytes read ('opened')
   *  (ARCHITECTURE-PLUS P3.3.3). Listeners run after the save's or open's promise has resolved, each
   *  in its own try/catch, never awaited: a listener that throws never makes a save fail. `time` is
   *  the clock when the bytes were written or read. */
  onWritten?(listener: (event: { path: VPath; bytes: Bytes; reason: 'saved' | 'opened'; time: number }) => void): () => void;

  /** The file's modification time recorded at open or the last save; null for a new document
   *  (exists as DocumentManager.fileTime). */
  fileTime?(id: string): number | null;
```

`state/dock.ts` (N1; N0 writes the stub, whose members do nothing and return false) is the per-window
dock controller. It imports neither `ui/dock` nor `flexlayout-react`; `ui/dock/DockWorkspace.tsx`
attaches the live model to it when it mounts.

```ts
export interface DockController {
  reveal(id: string, options?: { select?: boolean }): void;   // showPanel
  park(id: string): void;                                       // hidePanel (never for 'output')
  present(id: string): boolean;                                 // focusPanel: selects its tab
  /** True for N1's controller, also before DockWorkspace has attached a model; false for N0's stub. */
  acceptsTransient(): boolean;
  openTransient(spec: {
    id: `viewer:${number}`; title: string; tooltip: string; render(): ReactNode; onClose(): void;
  }): boolean;                                                  // false: acceptsTransient() is false
  selectTransient(id: string): boolean;
  closeTransient(id: string): void;
  /** The moves of P3.1.4; `near` is a panel id, `side` a side of P3.1.4's dialog. */
  move(panel: string, target: { kind: 'tab' | 'beside' | 'edge'; near?: string; side?: string }): void;
  setLocked(on: boolean): void;
  /** The lock state, for the check command `app.layout.lock`; N0's stub returns true (D2). */
  locked(): boolean;
  /** Called after any change of the arrangement or the lock (menus refresh their check state). */
  subscribe(listener: () => void): () => void;
  reset(): void;
  /** The visible panels, open viewers included, with their titles and the group each is in, for
   *  the dialog `layout.move` and the tab menu. */
  describe(): { panel: string; title: string; group: number }[];
}
export function dockOf(ctx: AppContext): DockController;
```

`openTransient` called before a model is attached, or while the Editor dock is not mounted, is
queued in `state/dock.ts` and applied when the Editor dock attaches; it returns true. N0's stub has
every member, each doing nothing, `acceptsTransient()` and `openTransient()` returning false,
`locked()` returning true, `describe()` an empty list. N1 may add members.

Transient tabs go into the group that holds `editor`, are never stored, and are announced like other
moves (`<name> opened.`). `onClose` runs whenever the tab goes away (its `x`, `closeTransient`, a mode
change), so the viewer can revoke its `blob:` URL.

Nothing is renamed or removed. `contracts.test.ts`'s list of exported names and its
`ADDED_DECLARATIONS` gain the new ones.

### P4.5 Place text

`app/src/core/places/display.ts` (new, pure; under Node):

```ts
export interface PlaceLabels { mount: string; label: string; kind: FileSystemBackend['kind'] }
/** The text a person reads for a path (P3.2.5). */
export function placeText(labels: readonly PlaceLabels[], path: VPath, platformKind: 'web' | 'desktop'): string;
/** The short form for messages: "lab1.X68 (on this computer)", "My Programs/demo/prog.X68". */
export function placeShort(labels: readonly PlaceLabels[], path: VPath): string;
```

Callers pass `ctx.vfs.backends()` mapped to `PlaceLabels`. Texts exactly as in P3.2.5.

---

## P5. Work packages

Every package, in addition to what is listed: unit tests for its own logic under Node without a DOM;
no file outside its paths except the listed changes to other packages' files; an entry in
`docs/differences/<id>.md` for each deliberate difference (this stage should have none: N8's change
keeps what a program reaches while a folder is within the snapshot limits, and beyond them only
changes which files are left out first, P3.3.10, R6); N10 carries every such entry into
`docs/DIFFERENCES.md`; requests for shared configuration in `docs/requests/<id>.md`; errata in
`docs/porting/errata/<id>.md`; the package's user-visible texts exported as constants from a
`texts.ts` in its own folder (`ui/dock/texts.ts`, `features/<x>/texts.ts`,
`core/trash-restore/texts.ts`, `core/places/texts.ts`, `core/history/texts.ts`: the question of
P3.3.4 when no copy can be kept, its `changed while` texts, the storage-tight toast and the texts
of P3.3.7, which N4 and N5
show; written final by N0, then owned by N3), which its
code and tests use; a result that
says what was verified by running and what was not. Browser checks follow the convention of `app/src/ui/shell/check-shell.mjs`: a script
`check-<name>.mjs` next to the code that starts the Vite development server on a free port, drives
headless Chromium and WebKit through Playwright, presses keys through the key map of the system it
runs on (Cmd where Windows has Ctrl), and prints `N of M checks passed`. Checks run in CI on Ubuntu,
macOS and Windows: N0 adds each new check to the root `package.json` and to the checks table of
`.github/workflows/ci.yml`.

Files of earlier packages that this stage changes are listed per package with exactly what changes.
Because the stage is built on its own branch after the release (P6), these changes do not collide
with the release work. Within the stage each file has exactly one N package as its editor; where a
file is written first by N0 as a stub and then by another package, it is written `N0 > N3` as in main
§8. A package that needs a line in a file it does not own asks that file's owner through
`docs/requests/<its id>.md`. Every existing test or check that a package's change breaks is changed
by that package in the same merge (P6.3), so that `plus` stays green after every merge. The two
integration scripts `tests/integration/wave1/check-wave1.mjs` and `wave2/check-wave2.mjs` are the
one exception to "one editor": N1, N5 and N8 each change only the rows their own change breaks
(N1 the listing's box and regions, N5 the Files rows, N8 the status text), each rebased on `plus`
before its merge.

**N0 - Foundation: dependencies, contracts, command tables, configuration** - tier mid - depends on:
the released version (P6)
- Read: P1, P2, P3.3.4 (the question and the storage-tight toast), P3.3.7, P3.6, P4; main §3.1,
  §3.12, §7.6, §8.
- First task, before any other package starts its browser work: the **PDF spike**. In the production
  build (`npm run build`, served locally under a sub-path) with `frame-src 'self' blob:` added, a page
  that shows a `blob:` PDF in an iframe is opened by a person in Chrome, Edge, Safari and the desktop
  app. The result goes into `docs/requests/N0.md`. If a browser refuses, R4's fallback applies from
  the start.
- Owns (new): `app/src/contracts/history.ts`; `app/src/core/places/**`; `app/src/core/plus/**`
  (`settings.ts`: `readPlus`, defaults); `docs/requests/N0.md`; and, as stubs with their final
  exported signatures, `app/src/fs/history-db.ts` (N0 > N3: `createHistoryService` returns a service
  whose state is `unavailable`), `app/src/fs/history-memory.ts` (N0 > N3: the same stub, P4.4),
  `app/src/core/history/texts.ts` (N0 > N3: `cannotKeepQuestion(command: 'delete' | 'replace' |
  'restore' | 'undo-copy', name: string, isFolder: boolean): string`, the two `changed while` texts
  of P3.3.4 step 4, the storage-tight toast and the texts of P3.3.7, final and exactly as P3.3.4 and
  P3.3.7 give them),
  `app/src/state/dock.ts` (N0 > N1), `app/src/core/trash-restore/**` (N0 > N4), and the feature folders `app/src/features/layout/` (N0 > N1),
  `history/` (N0 > N4), `viewer/` (N0 > N6: `createViewerService` whose `wants()` returns false),
  `additions/` (N0 > N7), `reload-offer/` (N0 > N8), each an `index.ts` exporting an empty
  `FeatureModule`, as W3 did.
- Changes: `app/package.json` and `package-lock.json` (P2.4); root `package.json` (the five scripts
  `check:dock`, `check:history`, `check:history-ui`, `check:viewer`, `check:status`; no aggregate
  check script exists); `tests/parity/matrix.json` (only if the 1.0.0 tag holds it, P6.3: the
  commands of P3.6 as `verifiedBy: web-e2e`); `.github/workflows/ci.yml` (the same five rows in the checks table);
  `.github/workflows/pages.yml` (`if: github.ref == 'refs/heads/main'` on the deploy job, so that a
  manual run on `plus` publishes nothing); `tests/e2e/editor/menus.spec.ts` (the Window menu's list,
  `ADDED`, and the items after the document list);
  `eslint.config.js` (P2.4: `FOLDER_PACKAGES`, the `ui/dock` layer, `fs/` to `core/history`,
  `features/history` to `ui/editor/fonts.ts`) and `tests/lint/import-rules.test.ts` (a passing and a
  failing case for each); `tools/vite-csp-plugin.mjs` (`frame-src 'self' blob:`);
  `desktop/src/security.ts` (the same directive in `CONTENT_SECURITY_POLICY`; `plugins: true` in
  `APP_WEB_PREFERENCES`, which in Electron enables only its PDF viewer, and `plugins: false` set
  explicitly in `CONTENT_WEB_PREFERENCES`, which spreads it); `tests/desktop/dev/security.spec.ts`
  and the other tests of `tests/desktop/dev/**` that assert the web preferences or the header;
  `tests/desktop/dev/menu.spec.ts` (the new native-menu items); `app/src/contracts/settings.ts`,
  `features.ts`, `documents.ts`, `index.ts`, `contracts.test.ts` (P4); `app/src/commands/ids.ts`,
  `specs.ts` (rows of P3.6), `tables/editor-menu.ts`, `tables/sim-menu.ts` (places of P3.1.4, P3.3.3,
  P3.5, with caption overrides), `menus.test.ts`, `tables/tables.test.ts`, the native-menu tests
  (`commands/native-menu.ts` needs no change if it resolves the same tables); `app/src/features/index.ts`
  (the five new features at the end of `FEATURES` and `FEATURE_NAMES`, in the order `layout`,
  `history`, `viewer`, `additions`, `reload-offer`; the two factories of P4.4) and
  `features/index.test.ts`; `app/src/bootstrap.ts` and `bootstrap.test.ts` (`history` and `viewer` as
  P4.4 says); `app/src/state/testing.ts` (the memory history of P4.4 and a stub viewer for tests).
- Acceptance: `npm ci`, typecheck, lint, test and build succeed on the three systems; every package the
  lockfile adds is MIT, BSD or ISC (a script prints the list; the result lists it); the pinned
  FlexLayout version is at least 14 days old (dates in `docs/requests/N0.md`); the built `index.html`
  carries the new `frame-src`; the desktop dev test of the web preferences expects `plugins: true` for
  the application window and `plugins: false` for content windows; the new commands appear in the
  menus at the places of P3.6 with no shortcut, in both key maps and the native menu; the Window
  menu's original items and its document list keep their positions, and the added items follow the
  document list; no item added by this stage shares its access key with another item of its menu,
  and every original caption is unchanged (new test); `tests/e2e/editor/menus.spec.ts` passes on
  `plus` with N0 merged; each new command is disabled
  until its handler exists; `readPlus` returns the defaults for every malformed value (table test);
  `placeText` and `placeShort` give every text of P3.2.5 (table test); the measured build increase is
  in `docs/requests/N0.md`; the lazily loaded merge chunk is in the service worker's precache
  manifest; the PDF spike's result is recorded.

**N1 - Dock layout** - tier strongest - depends on: N0
- Read: P1, P2.2, P3.1, P4.2, P4.4 (`DockController`); main §2.2-§2.4, §2.9-§2.11, §2.5 (full screen);
  errata W3 13, 14, 15, 16, 38, 41; `ui/shell/**`, `state/layout.ts`, `state/panels.ts`,
  `state/shell.ts`, `features/output/OutputPanel.tsx`, `features/hardware/index.ts`.
- Owns (new): `app/src/ui/dock/**` (`DockWorkspace.tsx`, `model.ts`: conversion between `DockNode`
  and FlexLayout's JSON, the model options of P2.2, defaults per mode built from `layout.splits`, the
  narrow default; `stored.ts`: `readDock`, `withDock`; `actions.ts`: the moves of P3.1.4 as FlexLayout
  actions; `transient.ts`: the transient tabs; `TabMenu.tsx`: the tab menu of P3.1.4; `splitters.ts`:
  the splitter names of P2.2; `dock.css`; `announce.ts`; `texts.ts`; `check-dock.mjs`);
  `app/src/state/dock.ts` (N0 > N1: the `DockController` of P4.4, which `state/panels.ts` calls,
  with the queue of transient requests); `app/src/features/layout/**` (N0 > N1: handlers of
  `app.layout.move`, `.lock`, `.reset`; the dialog `layout.move`). `features/layout` imports only
  `state/dock.ts` for the dock.
- Changes: `app/src/ui/shell/Shell.tsx` (Editor and Simulator workspaces become `DockWorkspace`; the
  Help drawer and `easybin` stay); `ui/shell/EditorWorkspace.tsx` and `SimWorkspace.tsx` (replaced by
  `DockWorkspace`; the message-height rule of `EditorCenter`, the Registers height and the Output
  expand button move into `ui/dock`; the files are deleted or reduced to re-exports, N1 decides and
  writes it in its erratum); `ui/shell/PanelRegion.tsx` (only if the dock needs a property to render
  a region inside a FlexLayout tab; its `data-e68-panel`, error boundary and roles stay);
  `ui/shell/shell.css`; `ui/shell/check-shell.mjs` and `shell.test.tsx` (the checks that assert
  today's regions, splitter names and the narrow layout are rewritten against the dock with the same
  meaning); `state/panels.ts` and `panels.test.ts` (P3.1.5: `showPanel`, `hidePanel`, `focusPanel`,
  `focusNextPanel` call the controller; the `focusPanelElement` visibility test); `state/layout.ts`
  and `layout.test.ts` (`SPLITS` stays; new export of the default fractions for the dock);
  `state/shell.ts` (`activeTool`/`outputInFront` kept in step); `app/src/styles/contrast.test.ts`
  (the dock's colour pairs); `features/output/check-output.mjs` and
  `features/hardware/check-hardware.mjs` where they locate panels by today's DOM structure;
  `tests/a11y/lib/structure.mjs` and `tests/a11y/lib/scan.mjs` (the tool `tablist` is no longer the
  first in the simulator; regions inside tabs); `app/src/App.test.tsx` (its region list and the
  workspaces' `hidden` pattern: the dock renders no panel content without layout, so the test
  asserts the dock's frame under Node and leaves the regions to `check-dock.mjs`);
  `tests/e2e/app/layout.spec.ts`, `tests/e2e/app/a11y.spec.ts`, `tests/e2e/editor/windows.spec.ts`
  where they assert regions, splitters or the shell's DOM; the listing's box and region rows of
  `tests/integration/wave1/check-wave1.mjs` and `wave2/check-wave2.mjs`.
- Acceptance:
  - unit: conversion round trip `DockNode` -> FlexLayout JSON -> `DockNode` for the defaults and 50
    random valid trees; `readDock` rejects every malformed case of P4.2; the default trees from stored
    splits equal today's proportions (table); `parked` puts a hidden-then-shown panel back next to its
    neighbour; `Reset Layout` leaves `layout.panels` byte-equal (property test over random layouts);
    a splitter drag in the default arrangement writes `layout.splits` and leaves `layout.dock` absent;
    each `Move` action yields the expected tree; every model option of P2.2 is set (one row each,
    the `keyMap` with each key explicit); `onAction` turns `DELETE_TAB` of each closable panel into
    `hidePanel` and refuses it for each other panel, refuses `DELETE_TABSET` of a group with a
    panel, and refuses a group action with one refused part; `hidePanel('output')` never calls
    `park`; `openTransient` before attach is queued and applied on attach; `locked()` follows
    `setLocked` and the stored value (absent = true), and `subscribe` is called on each change;
    `Move Tab Earlier/Later` yields the expected tab order and is disabled at the ends;
  - browser (`check-dock.mjs`, Chromium and WebKit, both key maps): with `Lock Layout` on (the
    default), the default arrangement of each mode has the panels at today's boxes within 1 px (the
    boxes `check-shell.mjs` measures today); unlocked, each group's outer box is today's box within
    1 px and its content box that minus its tab strip, except the Registers group (its content
    height plus its strip) and the groups below it in the left column, which share the rest; in the
    default arrangement the splitters carry today's names, also after a tab switch, a splitter drag,
    a move and a font change (or the erratum of P2.2 applies); collapsing and expanding the Output
    panel does not change its component's mount counter; from Editor mode, F4 and at once F9 on a
    program that reads a key: the key reaches the program (P3.1.5); unlocked (`Lock Layout`
    unchecked): drag a panel's tab to each of the five drop places of another group and
    to each window edge, and the panel is there; Esc cancels a drag; a drop of Output into a place
    smaller than 160 x 120 px is not offered; tab reorder by drag; locked and unlocked: the same
    moves through `Move Panel To...` with the keyboard only; tab menu `Move Left/Right/Up/Down`
    and `Move Tab Earlier/Later`, keyboard only, and their announcements; a transient test panel
    moved alone into a new group while locked shows its strip and its `x`; the Editor's messages
    splitter drag overrides the height rule until the message list changes; a closed tool panel comes
    back at its place with `View > <panel>`; close Hardware with its `x`, with Delete on its tab and
    with the tab menu, then `View > Hardware`: a program reads the switch byte `$00` each time; every
    View menu command and its shortcut shows and focuses its panel in three arrangements; F2 cycles
    in `PANEL_CYCLE` order in a moved arrangement; closing the focused panel moves the focus as
    P3.1.8 says; the arrangement survives a reload, and a second window keeps its own; `Lock Layout`
    shows today's strips only and refuses drags, while `Move Panel To...` still moves a panel and
    keeps the lock; `Reset Layout` restores the default and
    leaves the Hardware switch byte as it was (a program reads it before and after); moving the
    Hardware panel does not zero the switch byte (a program sets it, the panel is moved, the program
    reads it); Output full screen covers the window in three arrangements (`elementFromPoint`,
    P3.1.5); a running program receives every key of main §2.9.4 rule 4 and none of rule 1-3 in two
    arrangements, and the layout does not change while it types; while a program writes output
    continuously, the dock dispatches no action (an action counter in development builds); the
    editor's message list is 5, 87, 7 px by the rule in the default place, and the Registers group
    follows the panel's content height after a font change; every visible panel's component is
    mounted once, when its dock is first shown, and never remounted by moves, tab switches or mode
    switches (a mount counter in development builds); every existing suite, `App.test.tsx` and the
    X1 specs listed in Changes included, passes on `plus` with N1 merged; the reading order of the groups follows their position in three arrangements (P3.1.8);
    the narrow default below 1100 px and the switch back above it while the arrangement is default,
    also after a splitter drag; no animation under `prefers-reduced-motion`; the automatic
    accessibility scan (`@axe-core/playwright`) of each mode in both themes has no serious or
    critical finding; the live region announces each move; the contrast rules of main §2.8 hold for
    the dock's colours in both themes.

**N2 - Editor split and document tabs** - tier mid - depends on: N0
- Read: P3.1.4, P3.1.7; main §2.2, §2.4; editor-ui §2.5; errata E2; `ui/editor/**`,
  `ui/components/Tabs.tsx`.
- Owns (new): `app/src/ui/editor/split.ts` (the three split commands as functions on `PaneModel` and
  the layout setting) and its tests.
- Changes: `app/src/ui/components/Tabs.tsx` (W2): optional props
  `drag?: { type: string; data(id: string): string; onDropAt?(id: string | null, data: string): void }`
  - tabs are `draggable` only when it is given; `ui/components/Tabs.css`; the gallery files
  `ui/components/gallery/Gallery.tsx`, `samples.ts` and `check-gallery.mjs` (an example and a case
  for the new property; N2 > N4: N4 changes them after N2 is merged);
  `app/src/ui/editor/EditorPane.tsx` (tabs draggable with type `application/x-e68-document`; a drop on
  the other pane's strip or body moves the document there with `moveToOtherPane`;
  `EDITOR_CONTEXT_MENU` gains, below a separator after `Reload File`, `ed.file.history`; the tab
  tool-tip is `placeText`); `ui/editor/EditorArea.tsx` (the drop zone outline); `ui/editor/editor.css`;
  `app/src/features/editor/index.ts` and `commands.ts` (handlers of `ed.window.splitRight`,
  `splitDown`, `unsplit`); `features/editor/commands.test.ts` (its exact list of the feature's
  commands gains the three split commands); `ui/editor/check-editor.mjs` (new checks, including the
  tab tool-tip).
- Acceptance: unit: each split command from each of the three layouts with 0, 1, 2 and 5 documents
  gives the expected `PaneState` and layout; `Cascade`, `Tile Horizontally`, `Tile Vertically` behave
  exactly as before (the existing tests of Cascade and Tile pass unchanged); browser: drag a document tab to the other
  pane in both browsers; the split commands from the Window menu; the Window menu's document list
  and order are unchanged by moves; the tab tool-tip shows the place text for each store; the
  gallery check passes with the new `Tabs` property.

**N3 - History store** - tier strongest - depends on: N0
- Read: P3.3 (all), P4.3, P4.4; main §3.8.1, §3.8.6; `fs/browser-backend.ts` (transactions,
  `STORE_MESSAGES`), errata FS1.
- Owns (new): `app/src/core/history/**` (pure: the thinning schedule, the two pruning orders and
  admission, the untracked rule, place keys, the transaction plans as functions over an injected
  store interface, the size formatter; `texts.ts` N0 > N3); `app/src/fs/history-db.ts` (N0 > N3: the
  exports of P4.4 with their signatures unchanged); `app/src/fs/history-memory.ts` (N0 > N3: P4.4);
  `fs/history-db.test.ts`; `fs/history-model.ts` (test support: the reference model, the command
  driver that follows P3.2.2, P3.2.4, P3.2.7 and P3.3.8 step by step, and the exported checker
  `checkHistoryInvariants(db, vfs, model)` of the seven properties) and `fs/history-model.test.ts`
  (the model test below); `app/src/fs/check-history.mjs`.
- Changes: `app/src/fs/fsaccess-backend.ts` (FS2): the read-only getter `FolderBackend.rootHandle`.
- Acceptance:
  - **model test** (Node, fake IndexedDB as FS1's tests use, fake clock, a memory `Vfs`): a reference
    model beside the real store. The model holds the expected current files (path to bytes) and the
    list of copies the store has promised (each `guard` that resolved `kept`: path, bytes, half,
    time). Sequences of 200 steps from a seeded generator, seeds 1 to 2,000 in CI (the seed and the
    step are printed on a failure, and one seed can be run alone), drawn from the command driver of
    `fs/history-model.ts`, which follows P3.2.2, P3.2.4, P3.2.7 and P3.3.8 step by step: save (new
    content, small edits, 0.5 to 1 MB, binary), open, Delete of a file or a folder (with empty
    folders), Earlier Versions' Restore, Restore from the Trash (answers `replace`, `beside`,
    `cancel`, a skipped open document, the store not mounted), rename (a change of letter case
    included), move and copy with and without Replace (merges with skipped files included), import
    with Replace, Undo of each, Delete for Good, Empty Trash, Delete Earlier Versions, the switch off
    and on, the clock moved by 1 minute to 40 days followed by a global pass, a second service on the
    same database doing any of these (a second window, its steps interleaved at every await, saves
    into a folder between another service's phase 1 and its `act` included), a transaction aborted
    in the middle, a `Vfs` write or remove that fails, a page closed between two transactions (a new
    service on the same database), `B` lowered, and storage made tight; `confirm` answers Yes or No
    at random. The same seeds also run against `createMemoryHistoryService`. After every step it
    checks the seven properties of P3.3.1: (1) the memory `Vfs` equals the model's files: only the
    stated effects of the commands happened; (2) every `guard` either resolved `kept` and its bytes
    read back now (`versions` and `read` for `restore`; for `delete` and `replace`, every file that
    `act` removed or overwrote, with the bytes it had at that moment, is in the item of
    `trashItems`), or called `confirm` before `act`, and no `act` ran after `declined`; (3) every
    save wrote its file, whatever the history did, and resolved
    before the history's transaction for it; (4) each half's counted bytes are at most `B / 2` (after
    `B` is lowered, from the end of the next global pass) and equal the sum recomputed from the
    records; (5) read directly from the fake IndexedDB: every content is named by a version, every
    version's record exists, no place has two living records, no `dir` record is living, every
    record in the Trash has its item, and each record's `count`, `bytes` (128 per record and per
    version included) and `newestHash` match its versions; (6) every row of `versions` for every
    current file and of `trashItems` reads back, each content decompressing to its size and hash; (7)
    nothing was written below `.git`. A promised copy may leave the store only by a cause the model
    applies with the same rules, so that the model decides which copy goes: expiry at 30 or 60 days;
    the thinning schedule and the cap of 200 of P3.3.4 applied to its record; a drop the person asked
    for (Delete for Good, Empty Trash, Delete Earlier Versions, Delete History and Trash); a `Yes`
    without a copy for its file; a copy moving back with its record that is not admitted (above 1 MB,
    or no room); pruning of its half in that half's order (the Trash oldest item first; the versions
    half by step (1), then oldest first) by an admission whose change would have taken the half
    above `B / 2`, or by a global pass while the half was above `B / 2`; the lowering when storage is
    tight. The checker is `checkHistoryInvariants` of `fs/history-model.ts`, which N5 also runs
    (N5 acceptance). The test runs in at most 5 minutes on `ubuntu-latest`;
  - unit (same fakes): a save equal to the newest stores nothing; identical content in two files is
    stored once (`contents` count) and is deleted with the last version that names it; the schedule
    keeps exactly what P3.3.4 says for hand-made timelines (table), including one save every 5 minutes
    for 24 hours (the cap and the widening hold); an item at 29 and at 31 days; a version at 59 and at
    61 days, with and without being its record's newest; a copy of 20 MB and of 20 MB + 1 byte, and an
    item above `B / 2`, which call `confirm`; `B` with a quota of 400 MB; a fake IndexedDB that fails
    any request issued after a non-IndexedDB await inside a transaction passes every operation;
    `guard('delete')` then a new file at the same place: the new file's versions do not include the
    deleted file's; Trash restore with `Replace` over a file with versions: Earlier Versions of the
    place then lists the restored file's versions, and the Trash lists the replaced file (`Replaced`)
    with its own versions; a removal or a write that fails after `guard` kept leaves the file's
    versions at its place and no Trash item (and, for a folder, the removed files in the Trash);
    `guard('restore')` of a file that has versions but has grown above 1 MB keeps nothing and calls
    `confirm`; with the switch off, or in states `tight` and `unavailable`, `guard` keeps nothing and
    calls `confirm`, and after `Yes` the records of a deleted or replaced file are gone, while after
    `guard('restore')` and `Yes` the record and all its versions are still there; `guard` of a path
    below `.git` rejects without calling `act`; `guard` of a path that does not exist calls `act`
    without `confirm`; deleting a folder whose records hold `0.9 x B / 2` of earlier versions, with
    100 kB of current files, is kept, the Trash half grows by the copies only, and both halves stay
    at or below `B / 2`; restoring a 20 MB PDF from the Trash removes no version of another record
    and leaves no version above 1 MB in the versions half; a folder delete whose `act` finds one file
    changed since phase 1 leaves that file with its record living and the others in the Trash; the
    table of states of P4.4, one row per member and state; `moved` with a change of letter case in
    the browser store changes only `spelling`; a restore that creates an empty folder deletes its
    `dir` record; a restore of an item whose record re-entered the Trash as another item changes no
    record; `record`
    keeps nothing below `.git` or for an untracked file; re-importing a folder with a `.git` of 300
    files and five 5 MB PDFs keeps nothing and removes nothing; `restoreTrash` reports `gone` for an
    item dropped before it starts, leaves a file written and changes no record when the item is
    dropped while it runs, stops at `cancel` with only the files not yet written in the Trash,
    creates the empty folders, and never calls `guard` for a file that `before()` skips; a 3-file
    restore with the second file skipped, then a second restore: only the skipped file is asked about;
    `moved` and a restore onto a place held by a living record send that record to the Trash as
    `Replaced`; with the versions half full, 100 saves never remove a Trash item or a copy, and with
    the Trash half full, 10 deletes never remove an earlier version; admission prunes a half
    down to `0.9 x B / 2`; `locks` null: the global pass still runs and the properties hold; an open
    that never completes gives `unavailable` after 5 s (fake clock); the lowering when storage becomes
    tight happens once until free space has been above 64 MB, and `meta.notice` records it; the global
    pass runs in state `off`; the record queue drops the oldest beyond 16 MB; `record` stores the
    `time` it is given; `moved` changes one record per file; a record that does not parse is skipped
    and counted, while a `meta` record that does not parse yields `unavailable`, and `deleteAll`
    recovers; without `CompressionStream` contents are stored with `enc: 'none'`; the texts of P3.3.4
    exactly, from `texts.ts`;
  - **stress** (unit): content sizes drawn from the corpus (2 to 46 kB raw, plus 5 % of the files at
    0.5 to 1 MB), each save an edit of 1 to 20 lines, deletes of files and of folders of 5 to 20
    files. Runs: (a) 10,000 saves across 200 files over 90 simulated days in bursts (evenings of 50 to
    500 saves, gaps of up to 10 days) plus 500 deletes, `B` = 64 MB: it reports the typical-student
    figure that decides D4 (16 MB), and a burst of 500 saves in one hour leaves the daily versions of
    the week before untouched; (b) run (a) with `B` = 4 MB; (c) 200 files x 1 MB x 5 saves (1,000
    saves, about 1 GB) plus 200 saves of one 1 MB file plus 100 deletes of folders whose copies count 5 MB
    each after compression (500 MB of copies, about 15 times the Trash half, so that each delete after
    the first seven prunes once), `B` = 64 MB; (d) run (a) with `B` lowered from 64 MB to 2
    MB in the middle, as a drop of the quota would; (e) run (a) with storage made tight in the
    middle. Runs (b), (c) and (d) must each count at least 50 prunings of each half (in (d), after the
    drop), or the test fails, so that the limits are really exercised. Run (e) must show exactly one
    lowering of each half while storage stays tight, no version or item kept after the moment it
    became tight, and both halves at or below `B / 2` throughout. After **every** operation each half
    is at most `B / 2` (in (d), from the end of the first global pass after the drop), no living
    record has more than 200 versions, no save removed a Trash item and no delete removed an earlier
    version (from the pruning log), and the Trash lost items only oldest first. All runs together take at most 10 minutes on
    `ubuntu-latest`. **Cost**: the thousandth save of one file reads and writes the same number of
    records as the first (counted, not timed), and over 1,000 saves at the budget a half is pruned at
    most once per `0.1 x B / 2` of new counted bytes (counted);
  - browser (`check-history.mjs`, Chromium and WebKit): the same small scenario on real IndexedDB;
    after run (c) in Chromium, the result reports the ratio of the growth of `estimate().usage` to the
    counted bytes, and if it is above 2, `B` is divided by it (P3.3.4, Worst case); **storage full**
    in Chromium with the quota lowered as `features/files/check-files.mjs` does: a save of the file
    succeeds while history gives way, `state()` becomes `tight` and `meta.notice` is written once,
    and later saves keep no versions until room returns; **several windows**: two pages saving the
    same and different files at once 200 times end with totals equal to the sums of the records; two
    pages each deleting items of `B / 6` at the same time, 50 times: after every operation the Trash
    half is at most `B / 2`; two pages restoring the same item at once: the file is written from the
    Trash and the store's checks of the model test hold; the pass lock lets one page run the global
    pass at a time; `deleteAll` completes with a second page open; compression in both browsers gives
    the bytes back exactly.

**N4 - History and Trash dialogs, recording** - tier mid - depends on: N0; built at the same time as
N3, merged after it (P6.2)
- Read: P3.2.7 (Undo of a delete), P3.3.1, P3.3.3, P3.3.4 (the guard and its question), P3.3.7,
  P3.3.8, P3.3.9, P4.4 (`HistoryService`, its table of states, `restoreWithQuestions`); main §3.9,
  §2.7, §2.11.
- Owns: `app/src/features/history/**` (N0 > N4: feature module: `init` subscribes to
  `ctx.documents.onWritten` and calls `ctx.history.record` as P3.3.3 says, in a queued task, never
  awaited by a save; without `onWritten` it records nothing; it does not subscribe to `ctx.vfs`; the
  storage-tight toast of P3.3.4, shown once per window from `ctx.history.state()` and `subscribe`
  with the text of `core/history/texts.ts`; the dialogs `history.versions` and `history.trash`; the merge view loaded with `import()` and its `+` /
  `-` gutter; handlers of `ed.file.history`, `app.files.trash`; `texts.ts`; `check-history-ui.mjs`);
  `app/src/core/trash-restore/**` (N0 > N4: `restoreWithQuestions` and its texts, P4.4, used by the
  Trash dialog and by N5's Undo).
- Changes: `app/src/ui/components/DataGrid.tsx` (W2): optional
  `multiSelect?: { selected: ReadonlySet<number>; onChange(rows: ReadonlySet<number>): void }` with
  the Shift and Ctrl rules of P3.2.1, the keys of P1.3 and `aria-multiselectable`; without it the
  grid behaves exactly as today; the gallery files (N2 > N4, after N2 is merged): an example and a
  case for `multiSelect`.
- Acceptance: unit: a save of an open document records once with `saved`, with the bytes written and
  the event's `time`;
  opening records `opened` only when different; a write by a program (cached view) to a file that is
  open, and a write to a file that is not open, record nothing; `.L68`, `.S68`, over 1 MB and binary
  files record nothing; the storage-tight toast appears once per window when the state becomes
  `tight`, is not shown again until free space has been above 64 MB, and is shown again after a
  second shortage; restore of an open unmodified document reloads it, of a modified one shows
  the message, keeps no copy and writes nothing; Restore reads the chosen version before it calls
  `guard`; Restore keeps `Before restore` first; in states `off`, `tight` and `unavailable`, Restore
  (and a Trash `Restore` with `Yes` over a file) asks the question of P3.3.4, `No` leaves the current
  bytes unchanged and `Yes` writes without a copy; with `history` off, the dialog lists the versions
  kept before under the switched-off line and can restore them; each empty state of P3.3.8, the
  `.git` one included; a partial Trash restore ends with `2 of 5 files were restored. ...`; restore
  into an occupied place asks, `Yes` puts the replaced file into the Trash as `Replaced`, and `No`
  names the file `(restored)`; a Trash restore over a file open in the editor skips it when modified
  (that file stays in the Trash, `guard` does not run for it) and reloads it when not; an item that
  is `gone` shows the text of P3.2.7; a partial restore with `lost` files shows its sentence of
  P3.3.8; in states other than `ready` the Trash restore's replace question ends with `This cannot be
  undone.` and no second question follows; a Restore of a version pruned since the list was shown
  says `This version is no longer kept.`; each text of P3.3.7 in both dialogs: a record that does
  not parse gives the count line, an unavailable history gives the message and `Delete History and
  Trash`, whose question and `deleteAll` are run; `restoreWithQuestions` gives the same results for the dialog and
  for a call as N5's Undo makes it; a Trash item of a store that is not mounted offers My
  Programs/Restored (folder and desktop texts); every text of P3.3.8 exactly, from `texts.ts`; `DataGrid` without `multiSelect` is unchanged (its existing tests
  pass); browser: every control of both dialogs reached and operated with Tab, arrows, Enter and Esc
  only, the focus order written in the result, in both themes and both browsers; the comparison shows
  inserted and deleted lines with `+` and `-`; the unified view below 700 px; axe scan of both
  dialogs; the merge chunk loads offline after the first visit (service worker).

**N5 - Files panel** - tier strongest - depends on: N0; uses `ctx.history`; built at the same time
as N3, merged after it (P6.2)
- Read: P3.2 (all), P3.3.2-P3.3.5, P3.3.8 (restore texts), P3.3.9, P1.3, P4.4 (`HistoryService`,
  its table of states, `restoreWithQuestions`); main §2.2, §3.8.1, §3.8.5, §3.8.6; errata FS1, FS2;
  `features/files/**`, `features/files-fsaccess/**`.
- Owns (new): `app/src/features/files/selection.ts` (anchor, range, toggle, prune on removal), `bulk.ts`
  (bulk delete with the questions and the order of P3.2.2, bulk export, the export caption),
  `move.ts` (move and copy between folders and stores, `Move To` dialog `files.moveTo`), `undo.ts`
  (the stack of P3.2.7), `import-guard.ts` (P3.2.6), `git-guard.ts` (finding `.git` below a folder),
  `StorageLine.tsx`, their tests.
- Changes (FS1's files): `features/files/FilesPanel.tsx` (multi-select, keys of P1.3 with
  `data-e68-own-keys`, drag and drop, `Opened from this computer` root, `.git` hidden, storage line,
  Trash button, the new context items, focus after delete), `tree-model.ts` (selection set; linked
  root; `.git` filter; re-list on window focus), `actions.ts` (`deletePath` becomes the one-item case
  of `bulk.ts`; Import passes through `import-guard.ts`; replace on import calls
  `ctx.history.record(path, bytes, 'before-import', time)` with the current bytes of a file that gets
  versions, without waiting; rename calls `relocate` and `moved` and refuses a folder that holds
  `.git`), `store.ts` (`locations` gains the linked root; `displayPath` uses `placeShort`;
  `buildExport` leaves out `.git`; the copy into `/browser/Imported` calls `record(path, bytes,
  'before-import', time)` before it replaces a file with other bytes, P3.2.4), `files.css`, `index.ts` (the new dialog), `drop.ts`
  (import guard for dropped files), `check-files.mjs` (updated and extended), `index.test.ts`,
  `tree-model.test.ts`, `store.test.ts`; `features/files-fsaccess/check-fsaccess.mjs` (the Files panel
  now lists linked files; the message texts of `displayPath`); the Files rows of
  `tests/integration/wave1/check-wave1.mjs` and `wave2/check-wave2.mjs` (P5, introduction).
  `renameEntry` is not changed. Undo of a delete calls `restoreWithQuestions` (`core/trash-restore`,
  N4).
- Acceptance: unit (Node, memory backends): every selection rule of P3.2.1 (table of click and key
  sequences); every question and message text of P3.2.2, P3.2.4, P3.2.6, P3.2.7 exactly, for 1, 2, 3,
  4 and 10 items, files and folders, each store; deleting 5 selected items makes one Trash item per
  selected item, and Undo restores all 5; when `guard` cannot keep a copy of item 3 of 5 (a fake
  history), the question of P3.3.4 names it, `No` stops with items 3 to 5 selected and `Yes` deletes
  it for good and goes on; in states `off`, `tight` and `unavailable` the first question ends with
  `This cannot be undone.` and no second question follows; a removal failing at item 3 of 5 leaves
  items 3 to 5 selected; the toast offers Undo only when every item is in the Trash; undo of
  move, rename and copy, and each of their refusals; a 21st operation drops the oldest; move within a
  store keeps history (`ctx.history.moved`) and open documents follow (`relocate`); without
  `relocate` a move of an open file is refused; move across stores copies; refused targets refused;
  Move with Replace puts the replaced file into the Trash first, and when no copy can be kept asks
  the question of P3.3.4, whose `No` skips the file; Move
  with Replace over an open document skips it when modified (no `guard`, no Trash item) and reloads it
  when not, and closes it instead when the moved file's own open document follows to that path;
  Move of `demo/` (a, b) into a place holding `demo/` (b, c): c stays, b asks and goes to the Trash
  as `Replaced` on `Yes`, a is added; with `No` for b, `moved` is called for a only, and both b
  files keep their own histories; a rename that changes only letter case keeps the file's history;
  a folder delete during which another window saves a file into the folder leaves that file with
  the toast's sentence of P3.2.2; a merge into a folder that holds `.git` is refused; a Replace whose
  write fails leaves the target's versions under its place and no `Replaced` item; a removal that
  fails after `guard` kept leaves the file's versions under its place and no Trash item; Undo of a
  Copy puts the copies into the Trash, and asks the question of P3.3.4 when no copy can be kept;
  Undo of a Move or Copy with Replace brings the
  replaced files back to the target; Undo of a move of an open file relocates its document; after a
  toast's `Undo` the focus is on the first row brought back; a folder with an empty subfolder comes
  back with it after Delete and Undo; a dropped file that replaces one in `/browser/Imported` keeps
  a `Before import` version; the tokens of
  `data-e68-own-keys` equal `normalizeChord` of the chords of `ed.edit.selectAll`, `ed.edit.undo`
  and `ed.edit.redo` on each key map; a folder that holds `.git` (itself or deeper) is not deleted,
  moved, copied or renamed, with the texts of P3.2.2 and P3.2.4, and Export leaves `.git` out; export caption for
  each selection; bulk zip names with ` (2)`; import guard thresholds at 100/101 files and 10 MB/10 MB
  + 1 byte and the not-enough-room case; browser (`check-files.mjs`, both browsers, both key maps):
  Shift+click, Ctrl/Cmd+click, every key of P1.3, Ctrl/Cmd+A, Ctrl/Cmd+Z and the redo chords stay in
  the tree (the editor's text and undo are untouched), drag to move, the 800 ms expand of a folder
  row, and the copy cursor across stores, `Move To...` by keyboard, focus after a delete, the storage
  line with an estimate and in a page where it is absent, refreshed at most once per second, the
  large import question; in Chromium with a fake directory handle (as `check-fsaccess.mjs` does): the
  opened folder's root text; delete from it keeps a Trash copy; with the fake handle's write log,
  delete, move, copy, rename and Trash restore write and remove only the files they name (except the
  temporary name of a case-only rename, P1.1 rule 2, which must be gone when the command ends), and
  no path containing `/.git/` (any letter case) is ever written or removed by them; a linked file
  listed by its name and removed from the list without touching the real file; axe scan of the
  panel in both themes; every existing suite passes on `plus` with N5 merged; **with the real
  store**: N5's own bulk, move, rename, copy and undo code, driven by seeded sequences of those
  commands (seeds 1 to 200) against `createMemoryHistoryService` and a memory `Vfs`, passes
  `checkHistoryInvariants` of `fs/history-model.ts` (N3) after every step.

**N6 - Viewer and the documents' hooks** - tier mid - depends on: N0; its viewer panel needs N1's dock
- Read: P3.4, P4.4; main §3.9.2, §7.6; errata E1.
- Owns: `app/src/features/viewer/**` (N0 > N6: `createViewerService`, the viewer panel component, its
  download function, `check-viewer.mjs`).
- Changes (E1's files): `app/src/core/documents/service.ts`: in `open(path, options)`, after the bytes
  are read and before they are decoded, `if (!options?.asText && deps.viewer?.wants(path, bytes)) {
  deps.viewer.show(path, bytes); return null; }` (the "already open" question comes first, as today);
  `relocate(from, to)` of P4.4, which also rewrites the document's draft; `onWritten` of P4.4, called
  after a successful save, Save As or Auto Save with the bytes written and after an open with the
  bytes read, with `time` from the service's clock, each listener after the operation's promise has
  resolved and in its own try/catch; `fileTime` stays as it is and becomes part of the contract;
  `app/src/features/documents/index.ts` (passes `ctx.viewer` into the service's deps; a start-up
  file that the viewer takes is shown once the Editor dock attaches, and `startupDocument` then
  creates the template document as it does when `open` returns null, so the Editor holds a document
  as today; N6 is the only editor of this file in the stage); `features/documents/drafts.ts` (only if `relocate` needs a hook
  to rewrite a draft); `core/documents/service.test.ts` (new cases);
  `features/documents/check-documents.mjs` (opening a binary file).
- Acceptance: unit: the table of P3.4.1 for 20 names and contents including `.x68` with a zero byte
  (opens as text) and `PROG.S68`; `viewer` off opens everything as text; `open(path, { asText: true })`
  opens as text; `relocate` of a file and of a folder updates path, name and tab title and keeps text,
  `modified` and `revision`, and the draft names the new path; `onWritten` is called once per save,
  Save As, Auto Save and open, with the exact bytes and the time, and not for Reload; a listener
  that throws does not make Save fail; `wants()` is false when `acceptsTransient()` is false; a
  start-up PDF before the dock attaches is shown after it attaches; browser (with N1 merged):
  `?open=/browser/a.pdf` at start-up shows the viewer and the Editor holds the template document; with
  `navigator.pdfViewerEnabled` false (overridden in the page) the PDF notice with `Export` is shown;
  in Chromium and WebKit, an HTML file with an inline script, saved as `x.pdf` and as `x.svg` and
  opened in the viewer, runs no script (the script would set a `localStorage` key; the check asserts
  it is absent) and opens no window; a PNG, a JPEG, an SVG
  and a broken image in both browsers (rendered size, `alt`, the blob's type); a PDF's iframe has a
  `blob:` source of type `application/pdf` whose bytes equal the file's (read back with `fetch`) and
  no `sandbox` attribute; the production build shows no CSP violation when the viewer opens
  (Playwright's console and `securitypolicyviolation` listener against `npm run build` output served
  locally); `Open as Text`; `Export`; the `blob:` URL is revoked on close; Simulator `Open...` of an
  `.S68` and EASyBIN's open are unchanged with `viewer` on; axe scan.

**N7 - Port Additions dialog** - tier small - depends on: N0; uses `ctx.history`; merged after N3
(P6.2)
- Read: P3.5, P4.2.
- Owns: `app/src/features/additions/**` (N0 > N7: dialog `plus.options`, handler of
  `app.additions.options` with its argument).
- Acceptance: every text of P3.5; OK stores `app.plus`, Cancel does not; the buttons ask and act at
  once; `{ group: 'storage' }` puts the focus on `Empty Trash`; figures with and without `estimate`;
  the desktop variant of the texts; axe scan in both themes.

**N8 - Real folders, place names, Git folders** - tier small - depends on: N0
- Read: P3.2.5, P3.3.10; main §3.8.4; errata SH6, FS2.
- Owns: `app/src/features/reload-offer/**` (N0 > N8: the reload offer of P3.3.10, for every store,
  using `ctx.documents.fileTime` and `reload`); `app/src/ui/editor/check-status.mjs` (new: the status
  bar texts).
- Changes: `app/src/fs/sync/cached.ts` (SH6) and `app/src/fs/vfs.ts` (W1) `snapshot`: files below a
  `.git` folder are taken after all others, with the same limits, and not named in the `Not
  available` messages; they gain no write guard for `.git` (P1.1 rule 2);
  `app/src/ui/editor/EditorStatusBar.tsx` (E2): `EditorWindowStatus` shows `placeText`; the status
  text rows of `tests/integration/wave1/check-wave1.mjs` and `wave2/check-wave2.mjs` (P5,
  introduction). Where R6 turns out to be observable, N8 writes the entry in
  `docs/differences/N8.md`.
- Acceptance: unit: a folder within the limits loads the same set of files as before (property test
  over random trees with and without `.git`); a prepared folder with 3,000 files under `.git` and 50
  program files loads all 50 program files and no `Not available` message names a `.git` file; a
  program file in `.git/x.txt` of a small repository is still readable by `fileOpen`; the status bar
  text for each store; the reload toast appears for a changed unmodified document in each store and
  not for a modified one; a program's write to `.git/x.txt` still succeeds (no write guard);
  browser (`check-status.mjs`): a linked file's status bar shows `lab1.X68 - on this computer,
  edited in place`; two pages: a write of the file through the `Vfs` in one (as Restore does) offers
  a reload in the other; every existing suite passes on `plus` with N8 merged.

**N9 - End-to-end tests** - tier mid - depends on: N1 to N8
- Read: main §6.6; P6.3.
- Owns: `tests/e2e/plus/**` (`layout.spec.ts`, `files.spec.ts`, `history.spec.ts`, `viewer.spec.ts`).
- Changes (X1's files): `tests/e2e/fixtures/**` where the new specs need helpers. The existing X1
  specs and integration checks are changed by the package whose merge breaks them (P6.3).
- Acceptance: across packages, in Chromium and WebKit on the production build: a student imports a
  folder with a PDF, opens the PDF (viewer), opens a source, edits and saves three times, deletes the
  wrong file, restores it from the Trash, restores the second version from Earlier Versions, and
  the files' bytes equal the expected; a restore from Earlier Versions in one window offers a reload
  in the other; panels moved in both modes survive a reload; two windows: a
  save in one shows a new version in the other's open Earlier Versions dialog; offline after the
  first load: everything above works with the network cut; every earlier end-to-end test passes;
  `--repeat-each=20` on `ubuntu-latest` without a failure (main §6.9 item 10).

**N10 - Documentation** - tier small - depends on: N1 to N8
- Owns: changes to `docs/USER-GUIDE.md` (a section "Beyond the original": layout, Files panel, earlier
  versions and Trash, the viewer, Port Additions; how to take work out with Export), `docs/DIFFERENCES.md`
  (main §1.5's table gains the commands of P3.6), `app/public/help/Port/differences.htm` (regenerated
  with `npm run import:help`, never edited by hand), `docs/MANUAL-TEST-MAC.md` (the PDF rows of P3.4.2;
  VoiceOver over a dock move), `README.md` (one paragraph), `CHANGELOG.md`; a section 1.6 "Additions
  of the Plus stage" in `docs/ARCHITECTURE.md` that points here (the architect's file: N10 adds only
  that pointer, the two dependencies in §3.1's closed list, and the rows of P3.4.2 in §6.8's manual
  list); the entries of `docs/differences/<id>.md` that packages wrote (R4, R6), carried into
  `docs/DIFFERENCES.md`; `tools/check-guide-strings.mjs` (new).
- Acceptance: every caption and text quoted in the guide equals the code
  (`tools/check-guide-strings.mjs` compares the strings quoted in the guide with the constants
  exported by the packages' `texts.ts` files, P5, and the captions of `commands/specs.ts`); the in-app differences page equals `docs/DIFFERENCES.md` after
  `import:help`; the manual list has the new rows.

**NI - Integration** - tier strongest - the owner of the branch `plus` for the stage
- Owns: the branch `plus` and its merges; `docs/integration/plus.md` (the record of every merge and of
  the integration pass); `tools/diff-menus.mjs` (new: compares the resolved menus of `main` and
  `plus`); the version `1.1.0` in the package files and the tag `v1.1.0` on `main` after the final
  merge.
  (Corrected, P6.1: no version and no tag are set by the stage.)
- Acceptance: a package is merged only when every existing suite passes on `plus` with it merged;
  P6.4.

---

## P6. The order, the branch and integration

### P6.1 After the release, on a branch of its own

> **Corrected (the owner's decisions of 21 and 22 November 2026).** The stage was not held back until after a release. On 21 November the owner decided that it is built alongside the last work on the faithful port; on 22 November, that there is **one first public release, and it contains the additions**: no version of the faithful port alone is released before it. So in this section and the following ones: "the released version", "the 1.0.0 tag" and "from that tag" mean the `main` branch, whose changes are merged into `plus` between the stage's rounds; `plus` is merged into `main` after the integration pass of P6.4, and the definition of done of the main document (§6.9) is then checked on the merged `main`, which is what is released. No package sets a version or a tag: the version number of the first release is set when the release is made, and no document names a version of its own for the additions. Unchanged: nothing of the stage reaches `main` before the integration pass; no `v*` tag on `plus`; `pages.yml` and `release.yml` are never dispatched from a branch of the stage.

The stage starts after the faithful port is tagged (version 1.0.0 per main §6.9) and is built on the
branch `plus` from that tag. It does not hold the release back: nothing of it is merged into `main`
before the integration pass of P6.4 passes. Until then `main` carries only 1.0.x fixes; NI merges
them into `plus`, not the packages. No `v*` tag is set on `plus`, and `pages.yml` and `release.yml`
are never dispatched from it (N0's guard in `pages.yml` makes a manual run there publish nothing).

What the stage needs from the released version: the contracts as they are (P4.4 adds only optional
members and one optional parameter); `FeatureModule` and the bootstrap's service order;
`ui/shell/PanelRegion.tsx` and the panel ids; `FilesTreeModel`, `renameEntry`, `buildExport`,
`writeZip`; `DocumentService.open`, `reload`, `DocumentManager.fileTime`; `LinkedBackend`,
`FolderBackend`; the settings service's per-window `app.layout` and its rule that unknown keys are
kept; the kit's `Tabs`, `Dialog`, `DataGrid`, `ListBox`, `ContextMenu`, `Menu`, `Toast`; `check-*.mjs`
conventions and `tests/e2e/fixtures`.

### P6.2 What runs at the same time

Each package branches from `plus` and is merged into `plus` by NI as soon as its independent review
passes, so that later packages build on delivered work, not only on stubs. NI merges a package only
when every existing suite (unit tests, `check-*.mjs`, end-to-end and integration checks) passes on
`plus` with that package merged.

1. **N0** alone (a few days), including the PDF spike: merged first; every later package compiles
   against its contracts and stubs.
2. Then **N1, N2, N3, N4, N5, N6, N7, N8** at the same time. They touch disjoint files (P5). Until
   N3 is merged, N4, N5 and N7 develop against fakes of `HistoryService` in their own tests; they are
   merged only after N3, and their acceptance runs against `createMemoryHistoryService` (P4.4), which
   is then N3's store itself, so nothing they deliver is tested against a second implementation.
   Until N6 is merged, N4 and N5 test against a fake
   `DocumentService` (in their own tests) that has the optional members of P4.4 (`relocate`,
   `onWritten`, `fileTime`), and their code handles each member being absent as P3.2.4 and N4 say.
   N6's viewer panel's browser checks run once N1 is merged. N3 and N1 are merged as early as
   possible.
3. **N9** and **N10** after N1 to N8 are merged.
4. The integration pass (P6.4).

### P6.3 Existing checks and tests that will change

Foreseeable, each with the package that changes it: `app/src/ui/shell/check-shell.mjs` and
`shell.test.tsx` (regions, splitter labels `Resize the Files panel`, `Resize the two columns`,
`Resize the tool panels`, `Resize the Messages panel`, the narrow layout, tool tabs) - N1;
`app/src/state/panels.test.ts`, `layout.test.ts` - N1; `app/src/styles/contrast.test.ts` - N1;
`features/output/check-output.mjs`, `features/hardware/check-hardware.mjs` if they locate panels by
today's DOM structure - N1; `tests/a11y/lib/structure.mjs`, `tests/a11y/lib/scan.mjs` (the tool
`tablist`, regions in tabs) - N1; `app/src/App.test.tsx` (the region list and the workspaces; the
dock does not render panels without layout) - N1; `tests/e2e/app/layout.spec.ts`, `a11y.spec.ts`,
`tests/e2e/editor/windows.spec.ts` where they assert regions or splitters - N1;
`app/src/commands/menus.test.ts`, `tables/tables.test.ts`, the native-menu tests,
`bootstrap.test.ts`, `features/index.test.ts`, `contracts.test.ts` (new commands, new features, new
contract members) - N0; `tests/e2e/editor/menus.spec.ts` (the Window list, `ADDED`, the items after
the document list) - N0; `tests/desktop/dev/**` (web preferences, `plugins`; CSP header; native
menu items) - N0; `tests/lint/import-rules.test.ts` - N0; `app/src/features/editor/commands.test.ts`
(the exact command list gains the three split commands) - N2;
`app/src/features/files/check-files.mjs`, `index.test.ts`, `tree-model.test.ts`, `store.test.ts`
(single selection, `Delete "name"?`, Export, `displayPath` texts) - N5;
`features/files-fsaccess/check-fsaccess.mjs` (linked files now listed; message texts) - N5;
`app/src/ui/editor/check-editor.mjs` (tab tool-tip) - N2; the status bar's texts in the new
`ui/editor/check-status.mjs` - N8; `ui/components/gallery/Gallery.tsx`, `samples.ts`,
`check-gallery.mjs` (new `Tabs` and `DataGrid` properties) - N2 > N4 (N2 for `Tabs`, then N4 for
`DataGrid` after N2 is merged); `features/documents/check-documents.mjs` (opening a binary file) -
N6; `tests/integration/wave1/check-wave1.mjs`, `tests/integration/wave2/check-wave2.mjs` - by rows:
N1 the listing's box and regions, N5 the Files rows, N8 the status text (P5, introduction). N9
changes none of the existing specs; it adds `tests/e2e/plus/**`. If the 1.0.0 tag holds a parity matrix
(`tests/parity/matrix.json`, X2) whose test requires every command id to appear there, N0 adds the
new commands as `verifiedBy: web-e2e` pointing at N9's tests; otherwise nothing is added.

### P6.4 The integration pass

NI runs it on `plus` once every package is merged, and records it in `docs/integration/plus.md`:

- Every unit test, every `check-*.mjs` of the project and every end-to-end suite pass on Ubuntu,
  macOS and Windows in Chromium and WebKit, and the desktop tests on the macOS runners.
- The fidelity suites of main §6.9 items 1 to 4 pass unchanged (assembler, simulator, drawing,
  twins): this stage must not move one byte of them.
- The production build has no CSP violation in any mode, with a PDF and a picture open.
- The list of new packages and licences of N0 is attached to the pull request; none is Apache-2.0,
  GPL-incompatible or has an install script.
- The build increase is within 20 % of P2.4's estimate, or the difference is explained.
- A walk through every menu of the three modes on both key maps compares captions, order, access
  keys and shortcuts of the original items with `main`: `tools/diff-menus.mjs` diffs the resolved
  menus of `main` and `plus` (with and without open documents) and allows only additions below a
  separator at the end of a menu, the Window menu's after its document list.
- Then NI sets the version 1.1.0, merges `plus` into `main` and sets the tag `v1.1.0` on `main`;
  `pages.yml` publishes it and `release.yml` builds the tag.

> **Corrected (the owner's decision of 22 November 2026, see P6.1).** The last point is void: no version 1.1.0 and no tag `v1.1.0`. After the pass `plus` is merged into `main`; `pages.yml` then publishes the preview of `main` as it does for every push, and the first release is made from the merged `main` when its definition of done holds.

---

## P7. Risks and open decisions

Each has a default that is acted on. Rows marked **owner** are decisions only the project's owner can
take; the work proceeds on the default until the owner decides otherwise.

| # | Risk or decision | Default |
|---|---|---|
| R1 | FlexLayout 0.11.x is pre-1.0 and had three minor lines in six months; an update may break its API | pin exactly; our stored format is our own (P4.2), so a library change never loses a student's layout; updates only at an integration pass |
| R2 | A FlexLayout container creates a stacking context that breaks the Output panel's `position: fixed` full screen | the condition of P2.2 (no `z-index` on any dock layer) and N1's `elementFromPoint` check cover it; if it fails in an arrangement, the dock gives the `.flexlayout__tab` that holds the Output panel `z-index: calc(var(--z-modeless) - 1)` while full screen only (P3.1.5); no DOM node is moved outside React |
| R3 | FlexLayout's own key handling reaches events from the Output panel's textarea | the key map of P2.2 has only `closeTab`, every other key passed as `undefined`; N1's typing check in two arrangements |
| R4 | The built-in PDF viewer does not draw inside a `blob:` frame under the page's inherited CSP in some browser | found by N0's spike. First answer: `object-src blob:` is added to both policies, if the spike shows that it is enough, after NI's review (the page makes `blob:` URLs only with the explicit types of P3.4.2). If that does not help, the PDF viewer shows the notice of P3.4.2 with `Export` in that browser, N6 writes the entry in `docs/differences/N6.md` (N10 carries it into `docs/DIFFERENCES.md`), and no new window is opened; PDF.js is not added (licence) |
| R5 | `webPreferences.plugins: true` in the desktop app widens what the renderer may load | Electron has no plugin but its PDF viewer since Flash was removed; it is set for the application window only, content windows keep `plugins: false`; the protocol handler still serves only `app/dist`; the dev test asserts the rest of 7.6 unchanged |
| R6 | Taking `.git` files last changes which files a program reaches when a folder is beyond the limits | within the limits the set of files is exactly today's (N8's property test); beyond them it only changes which files are left out, where the original's behaviour depends on the order of a listing anyway. P1.1 rule 1 names this exception. No entry in `docs/DIFFERENCES.md`; if the reviewer finds a case a program can observe, N8 writes the entry in `docs/differences/N8.md` and N10 carries it |
| R7 | `navigator.storage.estimate()` counts the service worker's caches and other databases, so "free" is approximate | the texts say "about"; the budget uses `quota`, not `usage` |
| R8 | A student loses work that was never saved | out of reach of history by definition; the existing drafts (main §3.9.4) cover it |
| R9 | History of an opened folder is keyed by a stored directory handle; a browser that forgets handles (site data cleared) starts a new root | accepted: the history was cleared with it |
| R10 | Several windows move the same file at the same time | the second move finds the source gone and says `"prog.X68" no longer exists.` (FS1's text); no history is lost because `moved` changes only the living records at the old place, in one transaction (P3.3.5) |
| R11 | A 1.0 window open beside a Plus window overwrites `app.layout` without `dock` | accepted (P4.1): the next Plus window shows the default arrangement |
| D1 | Default of the two switches | on (P1.2) |
| D2 | **owner**: default of `Lock Layout` | on: the first start looks exactly as today and as the course's screenshots of the original; `Move Panel To...` works while locked, and `Window > Lock Layout` (Simulator: `View > Lock Layout`) unlocks dragging. The alternative, off, shows a tab strip of about 31 px on every group from the start (the Editor tab above the document tabs), and then only `Lock Layout` gives today's look back, because `Reset Layout` does not change the lock |
| D3 | Option A or B for version control | A (P3.3.2) |
| D4 | Deltas | not now; the format leaves room (P3.3.6); the next step if N3's typical-student figure is above 16 MB |
| D5 | Thinning numbers | P3.3.4; changed only with the stress test of N3 |
| D6 | Help stays a drawer | yes (P3.1.7) |
| D7 | Viewers survive a reload | no |
| D8 | **owner**: a folder that is a Git repository (holds `.git`) in the Files panel | not deleted, moved, copied or renamed there; the message says to use the student's own tools (P3.2.2, P3.2.4). The alternative would put a repository's history into the Trash, or delete it for good when it is over the Trash's limit |
| D9 | **owner**: the reload offer of P3.3.10 has no switch and works in every store | yes (P1.2): it appears only when an open, unmodified document's file was changed outside the window, and acts only on `Reload`. The alternative limits it to the opened folder and the desktop disk, where Git and other programs change files; two windows on My Programs would then rely on Save's question alone |
| D10 | **owner**: the `history` switch off | keeps no copies either: Delete, Replace and Restore then say `This cannot be undone.` (P3.3.4). The alternative keeps copies with the switch off, so that the switch would only stop automatic versions |
| D11 | **owner**: no copy can be kept | ask once, `<Do it> anyway? This cannot be undone.` (P3.3.4). The alternative refuses the command, which would block a delete when storage is full |
| D12 | **owner**: the Trash is full | the oldest items go first, whole, at any age (P3.3.4). The alternative protects items younger than 7 days and refuses to keep new ones meanwhile |
| D13 | **owner**: a deleted folder | its copies are kept whole or not at all, one question for the folder (P3.3.4). The alternative keeps the files that fit and asks about the rest |
| D14 | **owner**: `Yes` without a copy | the deleted or replaced file's earlier versions go with it (P3.3.4 step 3), so that no hidden history passes to a new file at its place. The alternative leaves them in the Trash without a copy, as rows that cannot be restored |
| D15 | **owner**: the budget | half for earlier versions, half for the Trash's copies; neither takes room from the other (P3.3.4). The alternative is one shared budget, where a large delete could push out a week of earlier versions |
| D16 | **owner**: the copy before Earlier Versions' `Restore` | at most 1 MB, like every earlier version; over a larger file, Restore asks the question of P3.3.4 (P3.3.3). The alternative allows 20 MB, which lets one restore push thousands of earlier versions of sources out |

What made additions harder than they look (found in the code):

- The Hardware panel's visibility is program state (`features/hardware/index.ts` sends
  `setVisible` on every change of `isPanelVisible`); a layout engine that "hides" a panel by removing
  it from the visible set, or a tab close that bypasses `hidePanel`, would change what the switch
  byte reads. P1.1 rule 4, P2.2's `onAction` and N1's checks exist for this.
- `focusPanelElement` (`state/panels.ts`) decides that a region is on screen by "not inside
  `[hidden]`"; a docking library hides tabs with styles, so every focus request, the F2 cycle and
  `View > <panel>` would focus an invisible region without the change in P3.1.5.
- The Output panel's full screen is `position: fixed` inside the panel (`features/output/output.css`)
  and covers the window by z-order only, which any ancestor that makes a stacking context or a
  containing block breaks (R2).
- The editor's 5/87/7 px message-list rule lives in the shell (`EditorWorkspace.tsx`, erratum W3 15),
  not in the panel, and so do the content-sized Registers region and the Output expand button
  (`SimWorkspace.tsx`); a dock must take them over for the default place.
- The Editor's Window menu ends with the original's numbered document list; additions go after it.
- `CachedSyncFiles.prepare` loads everything below a program's folder, `.git` included (P3.3.10).
- The linked files' folders `/linked/<id>/` are invisible in the Files panel by design
  (`locations()` excludes `linked`), and `EditorWindowStatus` prints `doc.path` as it is: both
  together made a linked file look like a copy.
- No `Vfs` rename exists: a move is copy and remove, and an open document does not follow a path
  change without `relocate` (P4.4).
- `VfsChange` carries only the path, the kind and the origin: a Save and a program's write through the
  cached view look the same, so versions are taken from the document service (P3.3.3).
- The document service is created by the bootstrap before any feature exists, and `AppContext`
  members come only from the bootstrap's factories (P4.4).
- The browser store's database has version 1 and closes itself on a version change
  (`db.onversionchange`), so adding stores to it would close it in every open window of an older
  version: the history has its own database.
- Ctrl+A, Ctrl+Z and the redo chords are bound commands (`ed.edit.selectAll`, `ed.edit.undo`,
  `ed.edit.redo`) that the dispatcher runs wherever the focus is not a text field, so the Files tree
  must own them (P1.3).

### Known open cases of the safety net, for the engineer who builds the store (N3)

The last reading of the document found these cases, in which the detailed rules of P3.3 either
give no answer or break one of the seven properties of P3.3.1. They are left open on purpose: by
the rule of precedence in P3.3.1 the property wins, N3 decides the smallest rule that keeps it,
records it as an erratum, and adds the sequence to the model test.

1. **A record pushed out of its place has no admission outcome.** A file is removed by a program,
   so its record stays living; then a Trash restore or `moved` writes another file at that place.
   P3.3.5 sends the old record to the Trash as `Replaced` with its newest version as its copy, but
   the admission rule of P3.3.4 covers only a copy made by `guard` and a copy moving back. When
   that copy does not fit the Trash half, property 4 breaks or the transaction has no defined
   result.
2. **Another window can prune a kept item between `guard`'s keep and its `act`.** Window A keeps an
   item for a delete; before A's `act` runs, window B deletes something large, and Trash admission
   prunes A's item, oldest first; then A's `act` removes the file. The file is gone with no copy
   and no question, against property 2.
3. **Stress run (c) of N3** depends on whether "down to 0.9 x B/2" counts the incoming change; with
   one reading it cannot reach its own 50 prunings. Fix the run's numbers to the rule as built.
4. **A living record can be left with no versions** when the copy of a single-version record is not
   admitted on moving back. Either such a record is deleted, or the rule "a living record whose
   last version goes is deleted with it" is restated.
5. **`Yes` without a copy drops the records of every file `guard` saw,** also of files that `act`
   left alone because they had changed meanwhile. Those files should keep their earlier versions.
6. **Older versions of a file in the Trash can be pruned by saves,** because they count in the
   versions half; its copy and its Trash item never are. Accepted as it stands, since the copy is
   what the Trash promises; say so in the Trash dialog's help text if N4 finds it surprises.

---

## P8. Out of scope and deferred

Out of scope, decided by the owner:

- **Help with writing code**: completion of mnemonics, directives and labels; error markers while
  typing; help on hover; an outline of labels and go-to-definition. They go beyond what EASy68K is,
  and in a course such help may not be wanted. No package of this or a later stage adds them without
  a new decision of the owner. The editor keeps behaving exactly as it does today (main §2.4:
  "No word wrap, no bracket matching, no auto-completion, no folding, no multiple cursors").
- **Git inside the application** in this stage (P3.3.2). Students who want Git use it on a folder of
  their disk.
- **Anything shared between people or machines** (sync, accounts, a server, push and pull from the
  web version through a relay): a different project with real running costs and people's credentials
  to protect.

Deferred, not in this stage:

- **Command palette**: a dialog listing every enabled command of the registry with a filter; about
  300 lines on `CommandRegistry` and the kit's `ListBox`, plus a free chord to be chosen then (P1.3
  lists those rejected). No adopted component brings it.
- **Quick file open**: the same dialog over `listTree` of every store; about 200 lines.
- **Find in files**: a search over every text file of a store with `@codemirror/search`'s search
  cursor (already a dependency) and a results panel in the dock; about 600 lines.
- **A Git panel** (option B's second half) on an opened folder of the real disk, if students ask; it
  would then be weighed again with the licence point of P2.3.
- **Deltas** in the history store (P3.3.6).
- **More than two editor panes**, floating panels, panels in other windows (P3.1.7).
- **Opening a PDF with the system's viewer from the desktop app** (needs a new IPC call to
  `shell.openPath` restricted to granted roots).

**An extension for Visual Studio Code.** Shipping the assembler and the simulator as an extension of
Visual Studio Code would bring that editor's whole interface for free, but it is a different product:
the original's menus, dialogs, panels and key rules (which this port reproduces) would not exist
there, and the simulator's panels would have to be rebuilt as web views. What this stage builds
neither helps nor hinders it much: the parts that would carry over are below the interface - the
engines and their binding (`app/src/engine`), `core/` (which runs without a DOM by main §0 rule 5),
and the file layer - and this stage leaves them untouched. The dock, the Files panel and the history
are interface of this application and would be replaced by Visual Studio Code's own.

---

## P9. Arranging panels freely (version 1.1)

Written by the architect on 25 November 2026, two days after the release of 1.0.0, from the owner's
first use of the released web version. This section is an addendum: P1 to P8 hold unchanged except
where a line below says otherwise. Where this section and an earlier one differ about what it
describes, this section is right.

### P9.1 Why

The owner, using the Simulator in a browser, wrote that it is hard to arrange things so that
everything can be seen, that the original has windows that can simply be rearranged, and that they
could not drag anything. Two causes, both decisions of this design:

1. `Lock Layout` is on by default (D2), and nothing on the screen says that it exists. A person who
   wants to move a panel tries to drag it, nothing happens, and they conclude that it cannot be done.
2. Floating panels were left out (P3.1.7). Docking answers "put this panel beside that one"; it does
   not answer "let me put the Hardware window where I want it, at the size I want", which is what
   the original's separate windows give and what the Simulator's many small panels need.

What this section adds: floating panels (P9.2), a visible way to find the arranging (P9.3) and
ready-made arrangements for the Simulator (P9.4). What it does not change: D2 (the first start looks
as it does today), every rule of P1.1, the original's menus, captions, access keys and chords, and
anything a 68000 program can observe.

### P9.2 Floating panels

**What a person sees.** Any panel of the dock, in each of the three modes, can leave the docked
arrangement and become a floating window inside the application window: a title bar with the
panel's name, the panel below it, a border. It is moved by dragging its title bar, resized at its
edges and corners, comes to the front when it is clicked or gets the keyboard, and lies above the
docked panels. Its title bar has a button `Dock` (the panel goes back to the place it was docked at
last; if that group is gone, to its place in the default arrangement of P3.1.3) and, for the panels
that have one today, the panel's own `x` (which closes the panel exactly as its `x` does today).
Several panels can float at once; a floating window holds one panel.

**Ways to make a panel float**, each also possible from the keyboard:

- the tab menu of P3.1.4 gains `Float` (and `Dock` on a floating window's title bar menu);
- `Move Panel To...` gains the place **As a floating window**;
- with the layout unlocked, dragging a tab and dropping it where there is no docking target;
- an arrangement of P9.4 that floats panels.

**The lock.** `Lock Layout` goes on meaning what it means: the docked arrangement cannot be changed
by dragging tabs. A floating window is a window: it can be moved, resized, docked and closed whether
the layout is locked or not, and `Float` and `Move Panel To...` work while locked, as
`Move Panel To...` does today.

**Keyboard.** The title bar is a Tab stop. Shift+F10 or the context-menu key on it (and a right
click) open its menu: `Move`, `Size`, `Dock`, and `Close` where the panel has an `x`. `Move` and
`Size` work as in a desktop window's system menu: the arrow keys move or size by 16 pixels, with
Shift by 1, Enter ends, Esc restores the place and size it had. In the Tab order and the reading
order, floating windows come after everything docked, in the order in which they were made to
float (not the order they are stacked in), each as: title bar, then the panel. A floating window is
not a dialog: it is a region named `<panel name>, floating`, and the rest of the application stays
usable.

**Bounds.** A floating window keeps at least 48 pixels of its title bar inside the application
window, in every direction, so that it can always be reached; when the application window gets
smaller, floating windows are moved back by that rule, never resized by it. The smallest size is
the panel's own minimum, and not less than 160 by 96 pixels. A panel made to float for the first
time gets the size it had while docked (not more than three quarters of the application window in
either direction) and a place cascaded from the last floating window; after that it remembers its
own.

**What may never change (P1.1) holds for a floating panel as for a docked one.** Showing or hiding a
panel is program state: floating, docking, moving and sizing never change
`layout.panels[id].visible`; a panel that is hidden while it floats is hidden, and floats again
where it was when it is shown. The Output panel may float: its keyboard rules (the chords a running
program receives, Ctrl+Alt+O to leave it, Alt+Enter for full screen) hold unchanged, and full screen
shows the panel as it does today. With no floating window, which is the state of the default
arrangement, the page is exactly what 1.0.0 draws: the same elements in the same order, the same
Tab order, the same reading order, within one pixel.

**How it is built.** flexlayout-react 0.11.1 has floating panels of its own (the options P2.2
switched off: `tabEnableFloat` and what belongs to it; popout into another browser window stays
off). The engineer establishes first whether the library's floating windows can meet every rule
above: keyboard move and size, the bounds, the reading order, the lock, a style without a `<style>`
element or anything the Content Security Policy refuses, state in the stored layout. If they can,
they are used. If they cannot, the floating windows are ours, drawn by `ui/dock` above the layout,
with the library holding only the docked panels; the erratum says which rule decided. Either way the
panel's content is the same component in the same React tree position as far as its state is
concerned: a panel that floats keeps what it shows (the Memory panel's address, the Hardware
panel's fields, the Output canvas) and is not created anew.

**Persistence.** The floating windows of a mode, with place, size and order, are part of the stored
arrangement of P3.1.6, per window, with the same rules for a stored layout that cannot be read.
`Reset Layout` docks every panel. A stored layout of 1.0.0 is read as it is (nothing floats).

**Not done.** A panel in a separate browser window or on a second screen (P3.1.7 stays for that
half); more than one panel in a floating window; minimising a floating window.

### P9.3 Finding it

- **A button `Arrange Panels` at the end of the toolbar** of each mode, after a separator, behind
  everything the toolbar has today (the original's buttons keep their order and places, P1.1). It
  is a toggle with the state of `Lock Layout` inverted: pressed means the tabs can be dragged. Its
  tool tip: `Arrange Panels: drag a panel by its tab, or right-click a tab for more (View > Lock
  Layout)`, with `Window > Lock Layout` in the Editor. It runs the command `app.layout.lock`; no new
  command.
- **A tip, once.** The first time a window shows the Simulator after this version is installed, a
  notice appears above the status bar (the kit's notice, as the storage notice of the Files panel:
  it takes no keyboard focus and is announced politely): `You can rearrange this window: make a
  panel float, dock it elsewhere or pick a ready-made layout in the View menu.` with the buttons
  `Arrange Panels` (unlocks the layout and closes the notice) and `Got it`. After either button it
  never comes again (a setting of its own, per browser profile); it does not appear while a program
  is running or waiting for input, and it comes at the next moment the Simulator is shown with no
  program running.
- The tab menu and `Move Panel To...` are where they were.

### P9.4 Ready-made arrangements for the Simulator

`View > Layouts` (a submenu after the stage's other items of the Simulator's View menu; the Editor
and EASyBIN have none) with four entries. Each sets the place of every panel of the Simulator,
shown or hidden; none shows or hides a panel (P1.1 rule 4); each keeps the lock as it is.

| Entry | Arrangement |
|---|---|
| `Classic` | the default arrangement of P3.1.3 (what `Reset Layout` gives) |
| `Wide Output` | registers and listing in the left column as today; the Output panel takes the whole height of the right column; the tool panels (Memory, Stack, Hardware, Break Points, Log) are tabs of one group below the listing; the message area stays under the left column |
| `Output and Hardware Side by Side` | as Classic, with the Hardware panel in a column of its own at the right of the Output panel, both at full height; the other tool panels as tabs below the listing |
| `Floating Tools` | as Classic for registers, listing, messages and Output; every tool panel floats, cascaded from the top right, at its default size: the arrangement nearest to the original's separate windows |

The exact proportions are the engineer's, chosen so that at 1366 by 768 and at 1920 by 1080 every
panel of an arrangement that is shown is usable without scrolling the page; they are recorded in
the erratum with a screenshot of each arrangement at both sizes in both themes.

### P9.5 Commands, texts and menus

- New commands, all additions (they join the list of P3.6 and section 1.5 of the main document):
  `app.layout.float` (`&Float`, the tab menu; with `{ panel }`), `app.layout.dock` (`&Dock`, the
  title bar and its menu), and `sim.view.layout.classic`, `.wideOutput`, `.sideBySide`,
  `.floatingTools` (the four entries of P9.4, captions as in the table, access keys chosen so that
  none collides inside the submenu). No chord is given to any of them.
- Every text a person reads is a constant in the `texts.ts` of the package that shows it, as P5
  says, and exactly the text of this section.
- The menus of the original keep their items, order, captions, access keys and chords:
  `tools/diff-menus.mjs` against the tag `v1.0.0` allows only additions after the items of the stage.

### P9.6 Packages

| Package | Owns | Depends on |
|---|---|---|
| **M1 Floating panels** | `app/src/ui/dock/**`, `app/src/state/dock.ts` (the controller gains `float(panel, rect?)`, `dock(panel)`, `floating()` and `arrange(arrangement)`, all optional members where a contract is touched), the tab menu's two items, `check-dock.mjs` (a pass `floating`, and every existing pass unchanged: 642 of 642 with nothing floating), erratum `M1.md` | - |
| **M2 Finding it and the ready-made arrangements** | `app/src/features/layout/**` (the dialog's new place, the notice, the arrangements as data, the four commands), the toolbar's button (`commands/tables/toolbars.ts`, `specs.ts`, the Simulator's View menu table: additions only), their checks, erratum `M2.md` | M1 |
| **M3 Tests and documents** | `tests/e2e/plus/arrange.spec.ts` and additions to `tests/e2e/fixtures/plus.ts`; the rows of the parity matrix for the new commands; the guide's section "Beyond the original" (a part "Arranging panels"), section 1.5 of the main document (rows for the new commands), fragments `docs/differences/M1.md` and `M2.md`, the manual list (a row: dragging and sizing a floating window with a trackpad and with VoiceOver), the change log's entry 1.1.0, one line of the README | M1, M2 |

Acceptance, beyond each package's own tests: with nothing floating and the tip dismissed, every
check and every end-to-end test of 1.0.0 passes unchanged (no existing test is changed except to
dismiss the tip where it would cover something, and the list of such changes is given); the
fidelity suites are untouched; `check-dock.mjs` passes in Chromium and WebKit with its new pass; the
end-to-end test floats the Hardware panel, moves and sizes it with the mouse and with the keyboard,
reloads and finds it where it was, docks it, picks each arrangement, and does all of it once with
`Lock Layout` on; the accessibility audit passes with a floating window open in both themes.

### P9.7 Decisions

| # | Decision | Taken |
|---|---|---|
| D7 | The default of `Lock Layout` after the owner's remark | stays on (D2): the first start looks as it does in 1.0.0 and as the tests pin it; the button and the tip of P9.3 are what makes the arranging findable |
| D8 | Floating windows and the lock | a floating window can always be moved and sized; the lock is about the docked arrangement |
| D9 | A panel in a separate browser window | not in 1.1 |
| D10 | The version | 1.1.0, released from `main` when this section's acceptance holds, by the route of 1.0.0 |

### P9.8 Corrections after the independent review (26 November 2026)

An independent reviewer used the built version as a student would, at 1366 by 768 and at 1920 by
1080, in both browsers and both themes, and wrote down every point at which they hesitated or
could not do what they wanted (`docs/integration/plus.md`, section 7). The architect's decisions
about what they found; where a rule below differs from P9.2 to P9.4, this section is right.

1. **`Floating Tools` is tiled, not cascaded.** The cascade of P9.4 put each tool window 24 pixels
   from the last, so the Memory window covered the Hardware panel's displays and switches and both
   covered the Output picture: the arrangement "nearest to the original" showed neither the
   program's output nor the hardware under test. The rule now: the tool panels that are shown are
   placed, in the order Hardware, Memory, Stack, Break Points, Log, at places where **no floating
   window covers another**, each at its default size, filling the right part of the dock from the
   top down and, when a column is full, a further column to the left; the Output panel keeps the
   left part of what was its column, so that at 1920 by 1080 with Hardware and Memory shown the
   whole Output picture at 100 % (640 by 480) is uncovered, and at 1366 by 768 the Hardware
   panel's displays, lamps and switches and at least the left 400 pixels of the Output picture are
   uncovered. Only when the shown tool panels cannot be placed without overlap in the dock (many
   panels, a small window) do the later ones overlap, cascaded by 24 pixels over the last column,
   and never over the Hardware window's displays and switches. A tool panel that is hidden has its
   place reserved by the same rule and takes it when it is shown.
2. **Where a window appears at its first Float.** Not 24 pixels from its docked place, where it
   covered the very neighbours a person wanted to see beside it: at the first free place of the
   rule of point 1 (the right part of the dock, top down, not over another floating window), and
   never over the tab strip of the group it came from.
3. **Making a panel float is something a person can find.** (a) A double click on a panel's tab
   makes it float; a double click on a floating window's title bar docks it. Both work with the
   layout locked, as `Float` and `Dock` do. (b) Every tab strip that is shown has, at its right
   end, a button `Float` (the picture of a window lifted from its place; tool tip `Float: make
   this panel a window of its own`), which floats the strip's selected panel; it is a Tab stop
   after the strip's tabs. (c) The tip of P9.3 reads: `You can rearrange this window: double-click
   a panel's tab to make it float, drag tabs to dock them elsewhere, or pick a ready-made layout
   in the View menu.` (d) Dropping a dragged tab on a group goes on docking it there (the library's
   rule, and what a person who knows such layouts expects); dropping it outside every group makes
   it float, as before.
4. **The bounds count the title, not the buttons.** At least 48 pixels of a floating window's
   title area (the part of the title bar that is neither `Dock` nor `x`) stay inside the
   application window in every direction.
5. **`Output and Hardware Side by Side` gives the Output panel the room its picture needs.** Where
   the two cannot both be shown whole, the Output column gets at least 648 pixels (the picture at
   100 % and its frame) before the Hardware column gets more than its own minimum; the Hardware
   panel scrolls inside itself (it does since this version).
6. **Ctrl+Alt+O and floating windows.** Leaving the Output panel with Ctrl+Alt+O goes to the next
   panel as before; when that panel floats, the keyboard lands on the floating window's title bar
   (from where Tab goes into the panel and the menu key opens Move, Size, Dock), not inside it.
7. **After a tab was dropped, the next click acts.** In WebKit the first click on the menu bar
   after a tab was dropped did not open the menu. If the released version behaves the same it is
   recorded; if it came with this version it is repaired.
8. Left as designed, and recorded as what a first-time user notices: the tip lies above the
   status bar over the lowest rows of the message area until it is answered; unlocking gives
   every group its tab strip, which moves the panels down by the height of a strip.

### P9.9 Corrections after the second independent review (26 November 2026)

A second reviewer used the version with P9.8 built. Two findings were major and three minor; the
architect's decisions follow. Where a rule below differs from P9.8, this section is right.

1. **The docked arrangement never scrolls as a whole.** A click on a floating window that had been
   pushed past the right edge scrolled the dock itself sideways, and the registers and the listing
   left the screen. The dock's root and the layer of the floating windows cannot be scrolled by
   anything: not by the focus, not by a script, not by a drag; a floating window that is partly
   outside is simply cut at the edge.
2. **`Floating Tools` opens further columns before it overlaps** (P9.8 point 1 as written, which
   was not built): when the column at the right is full, the next tool window goes to the top of a
   further column at its left, over docked panels if need be, and so on while a window fits in the
   dock without covering another floating window; only then the cascade. At 1920 by 1080 the five
   tool panels are placed without any overlap. The promise of P9.8 for Hardware and Memory (the
   Output picture uncovered) stays.
3. **The tip says what can be done on the page it appears on.** Its text: `You can rearrange this
   window. Press Arrange Panels to show each panel's tab; then double-click a tab to make the panel
   float, or drag it to dock it elsewhere. Ready-made layouts are in the View menu.` The buttons
   stay `Arrange Panels` and `Got it`.
4. **The room kept for the windows of `Floating Tools` is given back.** The arrangement lets the
   docked panels end where its windows begin (so that nothing is covered at the start). That room
   is kept only as far as shown floating windows still lie in it: when a window is moved, sized,
   docked or closed, the room shrinks to the columns that still hold a window, and when none does,
   the docked panels take the whole dock again. An empty strip is never left.
5. **At 1366 by 768 the Hardware window of `Floating Tools` has the width of what it holds**
   (its content's width, about 521 pixels), taken from the Output panel's share as far as the left
   400 pixels of the picture stay uncovered; its address fields are not cut.
6. Edits outside the paths of P9.6 that the second review listed (the shell's focus request for
   the title bar, the tiling rule in `app/src/state`, the new icon of the kit) are accepted: they
   are what points 1 to 6 of P9.8 needed.
