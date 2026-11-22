# N4 requests: the History and Trash dialogs

Status: open (N4, History and Trash dialogs, recording).

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

## 3. For the contracts engineer and N3: the name of an opened folder that is not open

P3.3.8's `"prog.X68" was in the folder "Lab", which is not open. ...` needs the folder's name.
`TrashItemInfo` (P4.4) has none; the store keeps it in its `roots` store (`{ handle, name }`).
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
