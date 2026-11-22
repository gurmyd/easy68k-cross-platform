# DV4: wiring the serial and network devices into the main process (for DV2)

Status: done. Both edits came to the main branch with the merge of DV4 (commit 7a1c3b4) and are
taken over by DV2 as they are, in the round before gate I3 (`desktop/src/main.ts` lines 69-70 and
228-229, `desktop/src/sync-ipc.ts` the Promise reply; docs/porting/errata/DV2.md entry D2).

Without these two changes nothing of 3.3.4 can run in the desktop app: no file of the main process
loads DV4's `desktop/src/net.ts` and `serial.ts`, and a device call cannot wait for an operation
that finishes later (docs/porting/errata/DV4.md, entry 3).

## 1. `desktop/src/main.ts`: register the devices

Two imports beside the import of `registerSyncIpc`:

```ts
import { registerNetDevices } from './net';
import { registerSerialDevices } from './serial';
```

and in `registerIpc()`, right after `registerSyncIpc(ipcMain, { grants, trusted, broadcast });`:

```ts
  // The serial and network devices of the windows (DV4, 3.3.4), on the device channels above.
  registerNetDevices({ testMode: testWindows !== null });
  registerSerialDevices({ testMode: testWindows !== null });
```

`testMode` installs `globalThis.__easy68kDevicesTest` (the device-call counter the tests read); it
is never on in a packaged app, since `testWindows` comes from `developmentOverrides`.

## 2. `desktop/src/sync-ipc.ts`: a device reply may be a Promise

In `registerSyncIpc`, the handler of `DEVICE_REQUEST_CHANNEL` becomes:

```ts
  ipcMain.on(DEVICE_REQUEST_CHANNEL, (event, channel: unknown, args: unknown) => {
    // Wrapped, so that a reply of `undefined` (no handler, or a host method's "no value") is a
    // reply too: a synchronous call whose returnValue is never set would block the page.
    const value = deps.trusted(event) ? answerDeviceRequest(event.sender, channel, args) : undefined;
    // A device operation that finishes later (open, bind, connect, send, name lookup: DV4) returns
    // a Promise; the page waits until it settles, as the original waits in the same system calls
    // (3.3.4). A rejection is answered with `undefined`, so the page never hangs.
    if (value instanceof Promise) {
      value.then(
        (settled: unknown) => {
          event.returnValue = { value: settled };
        },
        (error: unknown) => {
          console.error(`device call ${String(channel)} failed:`, error);
          event.returnValue = { value: undefined };
        },
      );
      return;
    }
    event.returnValue = { value };
  });
```

The comment of `DeviceRequestHandler` ("Whatever it returns is the reply") may add: "a Promise is
waited for".

## Checked

- `tests/desktop/dev/dv4-net.spec.ts` and `dv4-serial.spec.ts` (desktop-dev job, macOS runner, and
  the network part on Windows): every device call goes through these two paths.
- DV2's own specs in `tests/desktop/dev` ran unchanged in the same job.
