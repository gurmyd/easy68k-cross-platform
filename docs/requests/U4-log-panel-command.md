# Request from U4: a command that shows the Log panel (W3)

Status: open.

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
