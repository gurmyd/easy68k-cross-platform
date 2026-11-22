# DV4: `Platform.deviceBridge` in the contract (for W1)

Status: open. DV4 uses a local adapter meanwhile (docs/porting/errata/DV4.md, entry 1).

`features/desktop-devices` asks the main process which serial devices the machine has
(`serial.list`), for the Serial Ports dialog. The bridge is `DesktopPlatform.deviceBridge`
(`app/src/platform/desktop.ts`, DV2), which `Platform` in `app/src/contracts/platform.ts` does not
declare, so a feature cannot reach it with its type. Asked for, as DV2 errata 3 proposed:

```ts
/** The desktop app's device bridge (3.3.4): DesktopSerial, DesktopNet and the Serial Ports
 *  dialog use it. Null in a browser. */
readonly deviceBridge: DesktopDeviceBridge | null;
```

on `Platform` (web.ts gives null; desktop.ts has it already). Afterwards
`features/desktop-devices/model.ts` `deviceBridgeOf` can read `ctx.platform.deviceBridge`
directly.
