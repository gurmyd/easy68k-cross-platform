# Request from H1: the editor's selection and caret (W1 contracts; E2)

F1 in the editor looks up the selected text, or the word at the caret (editor-ui §15.3).
`DocumentService` (contracts/documents.ts) has no access to the selection or the caret, and the
editor component is E2's.

Today: `features/help/editor-context.ts` reads the browser's selection inside the region
`data-e68-panel="editor"` (the selected text, or the line that holds the caret, `.cm-line` for
CodeMirror). It works but sees the caret's line only, so "start of the text" cannot be told from
"start of a line" (errata/H1.md entry 7).

Request: `DocumentService.selection(id: string): { selected: string; caret: number } | null`
(caret = number of characters before it, in the text that `text(id)` returns). H1 then calls
`core/help` `editorHelpPage({ selected, text, caret })` with the whole text and drops the adapter's
`readEditorWordContext`.
