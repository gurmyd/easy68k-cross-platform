Status (item 1, contract): accepted as asked at gate I1 (contracts engineer, W1). `contracts/features.ts` has `ToastOptions { duration? }` and `DialogService.toast(text, action?, options?: ToastOptions)`. Items 2 and 3 are the shell engineer's and DV1's. Details: `docs/porting/errata/W1.md`, entry 11.

Status (item 2, shell, W3): done at gate I1. `state/dialogs.ts` puts `options.duration` (a finite number >= 0) on the `ToastEntry`, which the kit's `ToastStack` honours; check-shell.mjs shows that a toast with `duration: 0` is still there after 9 s. Item 3 is DV1's.

Status (item 3, DV1): done at gate I1, round 2. `features/pwa` passes `{ duration: 0 }` (`UPDATE_NOTICE_OPTIONS` in `register.ts`) and no longer repeats the notice every hour; `register.test.ts` checks both, through the real dialog service too. The request is closed.

# Request from DV1: a toast that stays until it is answered (gate I1)

Status: done (all three items, see the status lines above).

Addressed to: the gate's contracts engineer (`app/src/contracts/features.ts`) and the shell
engineer (`app/src/state/dialogs.ts`, `app/src/ui/shell/DialogHost.tsx`, W3's paths).

## Why

ARCHITECTURE.md 7.5: when a new version of the web app is installed and waits, every open page
shows `A new version is available.` with `Reload`, and nothing reloads by itself. `features/pwa`
shows it through `ctx.dialogs.toast(text, action)` (3.12.4). W2's `Toast` closes itself after 8 s
unless it has the pointer or the focus, and `DialogService.toast` has no way to ask for anything
else. A student who looks away for eight seconds never sees the notice. As a workaround
`features/pwa` shows it again at every page start and once an hour while a version waits
(errata/DV1.md entry 5). The DV1 review listed this as an open defect, to be repaired by a contract
change.

W2's component kit already supports it: `ToastItem.duration` in milliseconds, `0` = stays until
dismissed or its action is pressed (`app/src/ui/components/Toast.tsx`).

## The change

1. `app/src/contracts/features.ts`, `DialogService`:

   ```ts
   toast(text: string, action?: { label: string; run(): void }, options?: { duration?: number }): void;
   ```

   `duration` in milliseconds as for `ToastItem.duration`; `0` = the toast stays until it is
   dismissed or its action runs; omitted = the kit's default (8 s), so every existing caller is
   unchanged.

2. `app/src/state/dialogs.ts`: `ToastEntry` gets `readonly duration?: number`, set from
   `options.duration` when given; `DialogHost.tsx` passes the entries to `ToastStack` as before
   (a `ToastEntry` with `duration` is a valid `ToastItem`, so probably no change there).

3. DV1 then passes `{ duration: 0 }` from `features/pwa/index.ts` and drops the hourly repeat of
   the notice (the hourly update check of the worker stays). DV1 will make that change in its own
   paths as soon as the contract has the parameter; until then nothing in DV1 depends on it.
