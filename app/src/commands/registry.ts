// The command registry (ARCHITECTURE.md 3.12.2). Owner: W3.
//
// Every command of the application has a specification (specs.ts) from the first day and gets its
// handler from the feature package that owns it (FeatureModule.commands). Menus, toolbars, the
// keyboard dispatcher and the native menu of the desktop app all go through this registry:
//
// - a command without a handler is disabled everywhere and running it does nothing;
// - `run` does nothing while a modal dialog is open, whoever asks: a key, a toolbar button, or a
//   menu item of the desktop app's native menu (2.9.1 step 1). The one exception is the open
//   dialog's own code, which passes `{ allowInModal: true }` for its Help button and F1
//   (CommandRunOptions, docs/requests/H1-help-from-dialogs.md);
// - `run` does nothing when the handler reports the command disabled.

import type { AppContext, CommandHandler, CommandId, CommandRegistry, CommandSpec } from '../contracts';
import { COMMAND_SPECS } from './specs';

/** The registry plus what the shell needs beyond the contract. */
export interface CommandRegistryStore extends CommandRegistry {
  /** True once a handler is registered for the id. */
  hasHandler(id: CommandId): boolean;
  /** Every id with a specification. */
  ids(): CommandId[];
  /** Fires when a handler is registered. */
  subscribe(listener: () => void): () => void;
  /** The number of handlers registered so far. */
  handlerCount(): number;
  /**
   * A number that changes exactly when `subscribe` fires: when a handler is registered, and when
   * an override (below) starts or ends. Components that show commands re-resolve when it changes.
   */
  revision(): number;
  /**
   * For checks and the browser console of development builds only (check-shell.mjs); features
   * never call it. Puts `handler` in the place of the registered handler of `id`, or gives one to
   * a command that has none, until the returned function is called. Overrides of one id nest: the
   * latest one counts, and ending it restores the one before.
   */
  override(id: CommandId, handler: CommandHandler): () => void;
  /**
   * For checks and the browser console only. `listener` is told of every command that is about to
   * run: it has a handler, no modal dialog is open and it is enabled. Returning true keeps the
   * handler from running (the command counts as done), so that a check can press real keys
   * without opening the real dialogs. Returns the unsubscribe.
   */
  observeRuns(listener: (id: CommandId, arg?: unknown) => boolean | void): () => void;
}

export interface CommandRegistryDeps {
  /** The context handed to handlers. Read on every call, so it may be completed later. */
  context: () => AppContext;
  /** 2.9.1 step 1: commands do not run while this is true. */
  isModalOpen: () => boolean;
  /** Told when a handler throws or rejects; the command then counts as done. */
  onError?: (id: CommandId, error: unknown) => void;
  /** The specifications; default: every command of specs.ts. */
  specs?: Readonly<Record<string, CommandSpec>>;
}

export function createCommandRegistry(deps: CommandRegistryDeps): CommandRegistryStore {
  const specs: Readonly<Record<string, CommandSpec>> = deps.specs ?? COMMAND_SPECS;
  const registered = new Map<CommandId, CommandHandler>();
  /** Overrides by id, latest last (`override`). */
  const overrides = new Map<CommandId, { handler: CommandHandler }[]>();
  const listeners = new Set<() => void>();
  const runObservers = new Set<(id: CommandId, arg?: unknown) => boolean | void>();
  let revision = 0;
  const changed = () => {
    revision++;
    for (const listener of [...listeners]) listener();
  };
  /** The handler that counts for `id`: its latest override, else the registered one. */
  const handlers = {
    get: (id: CommandId): CommandHandler | undefined => overrides.get(id)?.at(-1)?.handler ?? registered.get(id),
    has: (id: CommandId): boolean => (overrides.get(id)?.length ?? 0) > 0 || registered.has(id),
  };
  const onError = deps.onError ?? ((id: CommandId, error: unknown) => console.error(`Command "${id}" failed:`, error));

  const spec = (id: CommandId): CommandSpec => {
    const found = Object.prototype.hasOwnProperty.call(specs, id) ? specs[id] : undefined;
    if (!found) throw new Error(`Unknown command id "${id}" (the ids are listed in app/src/commands/ids.ts)`);
    return found;
  };

  // `arg`: run() asks with the argument it was given, so that a command such as ed.file.history
  // { path } is judged by that argument (docs/requests/N4-history-ui.md item 6); menus, toolbars
  // and keys ask without one, as before.
  const isEnabled = (id: CommandId, arg?: unknown): boolean => {
    spec(id);
    const handler = handlers.get(id);
    if (!handler) return false;
    if (!handler.enabled) return true;
    const ctx = deps.context();
    try {
      return arg === undefined
        ? handler.enabled(ctx.store.getState(), ctx)
        : handler.enabled(ctx.store.getState(), ctx, arg);
    } catch (error) {
      onError(id, error);
      return false;
    }
  };

  return {
    spec,

    register(id, handler) {
      spec(id);
      if (registered.has(id))
        throw new Error(`Command "${id}" already has a handler: exactly one package owns each id`);
      registered.set(id, handler);
      changed();
    },

    async run(id, arg, options?: { allowInModal?: boolean }) {
      spec(id);
      const handler = handlers.get(id);
      // allowInModal: only the open dialog's own code passes it (its Help button and F1).
      if (!handler || (deps.isModalOpen() && options?.allowInModal !== true) || !isEnabled(id, arg)) return;
      let stopped = false;
      for (const observe of [...runObservers]) {
        try {
          if (observe(id, arg) === true) stopped = true;
        } catch (error) {
          onError(id, error);
        }
      }
      if (stopped) return;
      try {
        await handler.run(deps.context(), arg);
      } catch (error) {
        onError(id, error);
      }
    },

    isEnabled,

    isChecked(id, arg) {
      spec(id);
      const handler = handlers.get(id);
      if (!handler?.checked) return false;
      const ctx = deps.context();
      try {
        return handler.checked(ctx.store.getState(), ctx, arg);
      } catch (error) {
        onError(id, error);
        return false;
      }
    },

    hasHandler: (id) => handlers.has(id),
    handlerCount: () => registered.size,
    revision: () => revision,
    ids: () => Object.keys(specs),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    override(id, handler) {
      spec(id);
      const entry = { handler };
      const list = overrides.get(id) ?? [];
      list.push(entry);
      overrides.set(id, list);
      changed();
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        const current = overrides.get(id) ?? [];
        const index = current.indexOf(entry);
        if (index >= 0) current.splice(index, 1);
        if (current.length === 0) overrides.delete(id);
        changed();
      };
    },

    observeRuns(listener) {
      runObservers.add(listener);
      return () => {
        runObservers.delete(listener);
      };
    },
  };
}
