# M1 asks the contracts engineer: the stored floating windows in `DockLayouts`

Status: open (version 1.1, ARCHITECTURE-PLUS P9.2 Persistence).

P9.2: "The floating windows of a mode, with place, size and order, are part of the stored
arrangement of P3.1.6". The stored arrangement is `AppSettings.app.layout.dock: DockLayouts`
(`app/src/contracts/settings.ts`), which has no field for them. The settings service keeps keys
the defaults do not have, and `ui/dock/stored.ts` validates everything it reads, so M1 writes the
field already, typed locally as `StoredDock = DockLayouts & { floating?: ... }`. Asked: the same
field in the contract, optional, so that a stored layout of 1.0.0 stays valid.

In `app/src/contracts/settings.ts`, after `DockParked`:

```ts
/** A floating window's place and size, CSS px relative to the dock's top left corner (P9.2). */
export interface DockFloatRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A mode's floating windows, in the order they were made to float, and the remembered rects. */
export interface DockFloatingStored {
  windows: { panel: string; rect: DockFloatRect; home?: DockParked }[];
  remembered: Record<string, DockFloatRect>; // key = panel id
}
```

and in `DockLayouts`, after `parked?`:

```ts
  floating?: { editor?: DockFloatingStored; simulator?: DockFloatingStored }; // version 1.1 (P9.2)
```

`contracts.test.ts` would gain `'floating?: { editor?: DockFloatingStored; simulator?: DockFloatingStored };'`
in its list for `settings.ts`, and the two type names in its list of exported types.

When the contract has it, M1 replaces its local `StoredDock` type in `ui/dock/stored.ts` by
`DockLayouts` (no change of behaviour; `DockRect` of `state/dock.ts` can then be an alias of
`DockFloatRect`).
