Status: accepted at gate I1 (contracts engineer, W1). `contracts/fs.ts` now has `FolderRequest { title; startDir? }`, the optional `FileDialogs.chooseFolder?(request: FolderRequest): Promise<VPath | null>` and, for providers, `FileSourceProvider.chooseFolder?(request: FolderRequest)`; `contracts/platform.ts` has `NativeFileDialogs` (`open`, `save`, `chooseFolder(title: string)`) as the optional `Platform.nativeFileDialogs`. These signatures are final for this round. FS1 implements `FileDialogs.chooseFolder` and wraps the native dialogs in the `native` provider; H1 calls `ctx.fileDialogs.chooseFolder?.(...)` and keeps its `save` fallback while the member is absent. Details: `docs/porting/errata/W1.md`, entry 11.

# Request from H1: a folder chooser in the file dialogs (W1 contract; FS1, DV2)

`Help > Examples...` in the desktop app "asks for a folder, copies the examples there and shows the
open dialog in it" (ARCHITECTURE.md 5.8). `FileDialogs` (contracts/fs.ts) has `open` and `save`
for files only.

Today: H1 uses `save` with the title "Copy the Examples to (folder name)" and treats the name that the
user types as the folder to create (`showExamples` in `features/help/commands.ts`).

Request: `FileDialogs.chooseFolder(request: { title: string; startDir?: VPath }): Promise<VPath | null>`,
implemented by FS1 for the browser store and folder mounts and by DV2 with the native folder dialog.
H1 then calls it instead of `save`.
