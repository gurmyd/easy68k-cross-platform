Status: item 1 (contract) accepted in another form at gate I2 round 1 by W1: no new service on the application context, but the provider registry the file dialogs already have. `FileSourceProvider.linkFileHandle?(handle: FileSystemFileHandle): Promise<VPath | null>` (FS2's `fsaccess` provider implements it with `LinkedBackend.link`) and `FileDialogs.linkFileHandle?(handle)` (FS1's service hands the handle to the first provider that has the member; null when none has it), both optional, in `contracts/fs.ts`. `features/pwa` calls `ctx.fileDialogs.linkFileHandle?.(handle) ?? null`. Item 2 is now FS2's and FS1's (the dispatch in `FileDialogs`), item 3 DV1's. Details: `docs/porting/errata/W1.md`, entry 14. Filed by DV1 at gate I2 round 1. Addressed to the contracts engineer (W1), with FS2 and the gate.

Status (items 2 and 3): done in the round before I3. FS2's `upload` provider has `linkFileHandle` (`features/files-fsaccess/controller.ts`, with the linked file's banner; `controller.test.ts`). DV1 declares `file_handlers` for `.x68`, `.l68`, `.s68` in `app/public/manifest.webmanifest` and consumes `window.launchQueue` in `features/pwa/launch.ts` (`.X68`/`.L68`: Editor mode, opened; the first `.S68`: Simulator mode, loaded with the origin `association`; a file that cannot be linked is named in a toast; `launch.test.ts`). X1's manifest test no longer expects a failure, and `tests/e2e/app/launch.spec.ts` hands a real file handle to the page's launch queue in Chromium. Errata DV1.md entry 13. The request is closed.

# DV1: a way to hand a launched file to the file system (manifest file handlers, 5.7)

ARCHITECTURE.md 5.7: "Web, installed app: file handlers in the manifest for `.x68`, `.l68`, `.s68`
(Chromium) - as the desktop association". X1's `tests/e2e/app/offline.spec.ts` ("the manifest
declares file handlers...") expects them. DV1 has not declared them (errata DV1.md entry 6), because
declaring them without a consumer of `window.launchQueue` makes the installed app open an empty
window for every double-clicked file.

What is missing is one step, and it is not DV1's to take:

- A launched file arrives in `features/pwa` as a `FileSystemFileHandle`. `Platform.onOpenFiles`,
  `DocumentService.open` and `RunController.open` take `VPath`s.
- Since wave two FS2 has the step: `LinkedBackend.link(handle)` (`app/src/fs/fsaccess-backend.ts`)
  makes a `/linked/<id>/<name>` path that a later Save writes back to, which is what the desktop
  association does. But `features/pwa` may not import `app/src/fs` (layer rule: only
  `features/files` and `features/files-fsaccess` may), and nothing in the contracts reaches it.

Asked:

1. W1: an optional member through which a feature can link a handle, for example
   `FileSystemService.linkHandle?(handle: unknown): Promise<VPath | null>` on the application
   context (null where the browser has no File System Access API), registered by FS2.
2. FS2: implement it with `LinkedBackend.link`.
3. Then DV1 adds to `app/public/manifest.webmanifest`
   `"file_handlers": [{ "action": "./", "accept": { "text/plain": [".x68", ".l68", ".s68"] } }]`
   (one entry per extension group if Chromium wants it), consumes `window.launchQueue` in
   `features/pwa/register.ts`, links each file, and opens it by the rules of 5.7 (`.S68`: Simulator
   mode, load; others: Editor mode, open), with a test under Node and a step in `check-pwa.mjs`.

Until then X1's manifest test is expected to fail; it tests an item that is waiting for this request.
