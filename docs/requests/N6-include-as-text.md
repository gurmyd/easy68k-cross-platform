# N6: two opens that are not a person's Open must ask for text

Status: done (2026-11-22, the gate's closing engineer NI): both calls pass `{ asText: true }`; the
two rows of `callers.test.ts` are of kind `text` and its include case is an ordinary `it` that
passes with the real assembler. For: the engineer who closes the gate of the stage of additions (2026-11-22), or the
owner of `app/src/features/assemble/assemble.ts` (E5) and of
`app/src/features/files-fsaccess/controller.ts` (FS2). No package of the stage owns these two files
(P5 lists neither), so N6 does not edit them.

## Why

ARCHITECTURE-PLUS P3.4.1: only a person's own Open (the Files panel, `Open File...`, a drop, a
start-up argument) asks the viewer. Two calls of `DocumentService.open` are not a person's Open and
still pass no options, so with the viewer on (the default) they can send a file to a viewer tab:

1. `features/assemble/assemble.ts`, `routeMessages` (line 232 today):
   `const opened = await deps.documents.open(path).catch(() => null);`
   This opens an include file that the assembler's error rows refer to. An include file the viewer
   takes (a `.svg`, `.png`, `.pdf` ... name, or a zero byte in its first 8 KB) goes to a viewer tab,
   `open` returns null, and its rows stay under the assembled document instead of the include file
   opening as text with its rows, as before the stage. What the assembler produces does not change
   (it reads include and INCBIN files from the file system, `collect.ts`), only where the rows go.
2. `features/files-fsaccess/controller.ts`, `openContainingFolder` (line 346 today):
   `await this.ctx.documents.open(target);`
   This reopens, from the chosen folder, a linked document that was open (it is closed first). If
   it was open as text through `Open as Text` (a picture or a PDF), the reopen sends it to the viewer
   and the text document the person had is gone.

## The change asked for

1. `assemble.ts`: `deps.documents.open(path, { asText: true })` (the `Pick<DocumentService, ...>` of
   `AssembleDeps` already has the optional second parameter).
2. `controller.ts`: `this.ctx.documents.open(target, { asText: true })`.

Nothing else changes: with the viewer off, or for `.X68`, `.L68`, `.S68` and ordinary text files,
`{ asText: true }` opens exactly as before.

## How it is proved, and what to change in N6's test when it is applied

`app/src/features/viewer/callers.test.ts` (N6):

- lists every call of `documents.open(` in the application with its kind; the two calls above are of
  kind `request`. After the change, set their kind to `text` and their text to
  `open(path, { asText: true })` and `open(target, { asText: true })`;
- the case "an include file with errors that the viewer would take opens as text and holds its rows"
  is `it.fails` now (it reproduces the defect with the real assembler: the viewer is shown
  `/browser/inc/lib.svg`). After the change it passes, so `it.fails` reports a failure: make it `it`.

The same file also proves, and passes today, that a program that INCLUDEs a text file saved as
`.svg` and INCBINs a `.png` and a binary file assembles to the same `.L68`, `.S68`, messages and
counts with the viewer on as with it off, that nothing is shown in the viewer, and that the
assembler's and the simulator's file reads do not go through the document service.
