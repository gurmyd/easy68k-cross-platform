# M2: an optional member of `PlusSettings` for the tip of P9.3

Status: open (filed by M2, version 1.1, 25 November 2026).

To: the gate's contracts engineer (`app/src/contracts`).

## What

In `app/src/contracts/settings.ts`, `PlusSettings` gains one optional member:

```ts
export interface PlusSettings {
  viewer: boolean; // default true (P3.4)
  history: boolean; // default true (P3.3)
  /**
   * Version 1.1 (ARCHITECTURE-PLUS P9.3): true once `Arrange Panels` or `Got it` of the tip about
   * arranging the panels was pressed in this browser profile; absent (or anything but true): not
   * answered. Validated where it is read (core/plus/settings.ts arrangeTipAnswered).
   */
  arrangeTipAnswered?: boolean;
}
```

and `contracts.test.ts` lists it with the members of `PlusSettings` if that test pins them.

## Why

P9.3: after either button the tip "never comes again (a setting of its own, per browser profile)".
The task of M2 puts that setting where the stage keeps its settings, `AppSettings.plus`
(`core/plus/settings.ts`, an optional member). Every setting but `app.layout` is shared by every
window of the profile at once (errata W3 16), which is what P9.3 asks.

## Until then

`core/plus/settings.ts` declares `StoredPlus = PlusSettings & { arrangeTipAnswered?: boolean }`,
reads the member from what is stored (as it reads the two switches) and writes it with that type;
nothing else depends on the contract. When the member is in the contract, `StoredPlus` can become
`PlusSettings` (one line, owner M2 or N0). `withPlus` (the dialog `Port Additions...`) now keeps the
member when it writes the switches; before version 1.1 it rebuilt `plus` from the two switches only,
which would have brought the tip back after an OK of that dialog.
