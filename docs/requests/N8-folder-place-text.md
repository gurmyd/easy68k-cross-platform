# N8: the place text of an opened folder repeats `Folder: `

Status: open. For: the owner of `app/src/core/places/display.ts` (N0, finished; the orchestrator
decides who changes it). Filed by N8.

## What is wrong

P3.2.5 gives the place text of a file in the opened folder as
`Lab/prog.X68 - in the folder "Lab" on this computer`. `placeText` builds it from the backend's
`label`, and the opened folder's label is FS2's `folderLabel(name)`, which is `Folder: Lab`
(`app/src/fs/fsaccess-backend.ts`). So the status bar of Editor mode, which N8 now fills with
`placeText` (P5 N8), reads in Chromium:

    Folder: Lab/prog.X68 - in the folder "Folder: Lab" on this computer

(seen in `build/N8-plus/status-check/chromium-folder-status.png`, printed as a `note` by
`app/src/ui/editor/check-status.mjs`). N0's table test passes a label `Lab`, so it does not show it.
The same will happen to every caller of `placeText` and `placeShort` (N2's tab tool-tip, N5's
`displayPath`) that passes `ctx.vfs.backends()` as P4.5 says.

## What N8 did

Nothing in `core/places` (not N8's). `EditorWindowStatus` passes the backends as P4.5 says, so the
status bar follows as soon as `display.ts` is changed. N8's unit test uses a folder whose label is
`Lab` and expects the text of P3.2.5; `check-status.mjs` checks only that the text names the file,
the folder and "on this computer" and not `/folder/`, and prints the exact text.

## Asked

One of, in `app/src/core/places/display.ts` (with its table test):

1. for the mount `folder`, use the label without a leading `Folder: ` (the words of FS2's
   `folderLabel`, which core may not import; a constant in `core/places/texts.ts` would hold them);
   or
2. give `PlaceLabels` an optional `name` (the folder's own name) and use it for `folder` when present;
   callers would then pass `rootHandle.name`, which a feature cannot reach, so option 1 is simpler.

`check-status.mjs` turns its note into a check (`FOLDER_TEXT`) once this is done.
