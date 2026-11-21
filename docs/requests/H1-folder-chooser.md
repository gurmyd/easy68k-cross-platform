# Request from H1: a folder chooser in the file dialogs (W1 contract; FS1, DV2)

`Help > Examples...` in the desktop app "asks for a folder, copies the examples there and shows the
open dialog in it" (ARCHITECTURE.md 5.8). `FileDialogs` (contracts/fs.ts) has `open` and `save`
for files only.

Today: H1 uses `save` with the title "Copy the Examples to (folder name)" and treats the name that the
user types as the folder to create (`showExamples` in `features/help/commands.ts`).

Request: `FileDialogs.chooseFolder(request: { title: string; startDir?: VPath }): Promise<VPath | null>`,
implemented by FS1 for the browser store and folder mounts and by DV2 with the native folder dialog.
H1 then calls it instead of `save`.
