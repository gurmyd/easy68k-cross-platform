# N4 requests: the History and Trash dialogs

Status: items 2, 3 and 4 done at the gate (the contract has `MessageBoxRequest.defaultButton`,
`TrashItemInfo.folderName` and the two members of `HistoryService`; N3 and N4 use them); item 1:
the contract has `newSourceWithText?`, N4 calls it when the document service has it, and
`core/documents/service.ts` implements it (the gate's closing engineer, 2026-11-22; unit test in
`core/documents/service.test.ts`), so the editor-extension fallback of `open-as-new.ts` now runs
only with a document service that lacks the member; item 5 information
only; item 6 done at the gate (`CommandHandler.enabled(state, ctx, arg?)`,
`CommandRegistry.isEnabled(id, arg?)`, and `run` asks with its own argument; test in
`commands/registry.test.ts`) (N4, History and Trash dialogs, recording).

## 1. For the contracts engineer (and the owner of `core/documents/service.ts`): a new document with a text

P3.3.8's `Open as New Document` "opens a new untitled source document with the version's text".
`DocumentService` (`app/src/contracts/documents.ts`) can make a new document only from the
template. Suggested addition, optional so that nothing else changes:

```ts
  /** A new untitled source document holding `text` ("\n" line ends) instead of the template,
   *  modified, with the Editor Options settings (ARCHITECTURE-PLUS P3.3.8). */
  newSourceWithText?(text: string): DocumentState;
```

`DocumentManager` can implement it with its `add(...)` as `newSource()` does. Until it exists,
`features/history/open-as-new.ts` puts the text in through `ctx.editorExtensions` (errata N4 entry 8);
when it exists N4 (or the integration pass) replaces that file's body with the call.

## 2. For the contracts engineer and the shell (W3): the default button of a message box

P3.3.4's question has `Yes`, `No`, "No has the focus" (also P3.2.2's Delete question, N5). Suggested:
`MessageBoxRequest.defaultButton?: number` (index into `buttons`, default 0), passed by
`ui/shell/DialogHost.tsx` to the kit's `MessageBox`, which already has `defaultButton`. N4 and N5
would then pass `defaultButton: 1` for these questions. Errata N4 entry 1.

Gate round (N4's side done): this item is superseded by `docs/requests/N5-default-button.md`, which
asks for `defaultButton?: MessageBoxRequest['buttons'][number]` (the caption). N4 now passes
`defaultButton: 'No'` in every question of P3.3.4 it asks (`cannotKeepBox` of
`core/trash-restore/restore-flow.ts`, used by `restoreWithQuestions` and Earlier Versions' Restore;
N5 may use it too), so only the contract member and DialogHost passing it on remain.

## 3. For the contracts engineer and N3: the name of an opened folder that is not open

P3.3.8's `"prog.X68" was in the folder "Lab", which is not open. ...` needs the folder's name.
`TrashItemInfo` (P4.4) has none; the store keeps it in its `roots` store (`{ handle, name }`).

Gate round (N3's and N4's sides done): the store now sets `folderName` on the `TrashItemInfo` of an
item of an opened folder (the roots store's `name`), and `restoreWithQuestions` names that folder.
Only the optional member in `contracts/history.ts` remains, so that it is read without a cast.
Suggested: `TrashItemInfo.folderName?: string` (the root's name, for an item of `/folder`). N4 already
reads it when present (errata N4 entry 3).

## 4. Seconding `docs/requests/N3-history-contract.md` item 1

`unreadable?()` and `unavailableDetail?()` on `HistoryService`: N4's dialogs read them today without a
cast in the type of the contract (errata N4 entry 9).

## 5. For the configuration engineer: `check:history-ui` makes a production build

`app/src/features/history/check-history-ui.mjs` (already named by `check:history-ui` and the CI row
`history_ui`) runs in two parts: the dialogs in the development server, then a production build of
`app/` into its output folder (`vite build`, about a minute on this machine) for the offline check of
the merge view's chunk. `--part dialogs` or `--part offline` runs one of them. Nothing needs to change
in the configuration; the job takes longer by the build.

## 6. For the contracts engineer and the owner of `commands/registry.ts`: `enabled` sees the argument

Filed at the gate. P3.6: `ed.file.history` takes `{ path?: VPath }` and is enabled while "the path is
a file outside `/memory`", the path being the argument's. `CommandHandler.enabled(state, ctx)`
receives no argument, and `CommandRegistry.run(id, arg)` checks `isEnabled(id)` without it, so the
Files panel's `Earlier Versions...` (`ctx.commands.run('ed.file.history', { path })`, N5) does
nothing while an untitled document is active (the gate's finding; errata N4 entry 10).

Asked, optional so that no handler changes:

```ts
// contracts/commands.ts, CommandHandler
enabled?(state: AppState, ctx: AppContext, arg?: unknown): boolean;
// contracts/commands.ts, CommandRegistry, and commands/registry.ts
isEnabled(id: CommandId, arg?: unknown): boolean;
// commands/registry.ts, run(): pass the argument on
if (!handler || (deps.isModalOpen() && options?.allowInModal !== true) || !isEnabled(id, arg)) return;
```

(`isChecked` already receives `arg` the same way.) N4's side is done: the handler's `enabled` already
takes `(state, ctx, arg?)` and decides by `arg.path` when there is one (tested in
`features/history/history.test.ts`, "with an explicit path"). Menus keep asking without an argument,
so the File menu and the editor's context menu stay as they are. Until this is applied, N5 can open
the dialog itself with `ctx.dialogs.open('history.versions', { path })`.
