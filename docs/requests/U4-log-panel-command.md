# Request from U4: a command that shows the Log panel (W3)

Status: closed (U4, round before gate I3): all three items are done. Items 1 and 2 by W3 at gate I2 (below); the handler by U4 at gate I2 (`features/log/index.ts`, tested in `log.test.ts`, "View > Log (sim.view.log) shows the Log panel"); item 3 by the document's owner: ARCHITECTURE.md 1.5 has the row "`Log` panel show (erratum W3 40) | `sim.view.log` | end of the simulator's View menu", and so has DIFFERENCES.md. Nothing is left for anyone.

Earlier status: items 1 and 2 done at gate I2 (W3): `sim.view.log` (mode simulator, kind action, caption `&Log`, no keys) is in `commands/ids.ts` and `specs.ts` and at the end of the simulator's View menu below a separator (`tables/sim-menu.ts`). Item 3 (the line in 1.5) is for the document's owner; recorded in errata W3.md, not edited by W3. U4 then added the handler below to `features/log/index.ts` (gate I2); the browser check opens the panel from View > Log.

The Log panel (ARCHITECTURE.md 1.5, 2.4, 2.6) is registered by `features/log` under the panel id
`log` and appears as the last tool tab once it is visible. Nothing in the interface makes it
visible: the View menu (`app/src/commands/tables/sim-menu.ts`) has the original's items only, 1.5's
list of added commands has no entry for it, and its default is hidden (2.4). Today only a settings
file with `layout.panels.log.visible = true` shows it.

Requested (W3, owner of `commands/ids.ts`, `commands/specs.ts`, `commands/tables/sim-menu.ts`):

1. A command id `sim.view.log`, mode `simulator`, kind `action`, caption `&Log`, no keys.
2. In the simulator's View menu, after the original items, below a separator (1.5: "Commands the
   port added come after the original items of their menu, below a separator").
3. A line in 1.5's table of added commands: `Log` panel show | `sim.view.log` | end of the
   simulator's View menu | - | -.

U4 then adds the handler to `features/log/index.ts`:

```ts
'sim.view.log': { run: (ctx) => showPanel(ctx, 'log') },
```

as `sim.view.stack` does for the Stack panel. Until then the handler is absent (a second handler for
an id that does not exist would make bootstrap throw).
