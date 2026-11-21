// The command registry (ARCHITECTURE.md 3.12.2). Owner: W3.
//
// Every command of the application has a specification (specs.ts) from the first day and gets its
// handler from the feature package that owns it (FeatureModule.commands). Menus, toolbars, the
// keyboard dispatcher and the native menu of the desktop app all go through this registry:
//
// - a command without a handler is disabled everywhere and running it does nothing;
// - `run` does nothing while a modal dialog is open, whoever asks: a key, a toolbar button, or a
//   menu item of the desktop app's native menu (2.9.1 step 1);
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
  /** The number of handlers registered so far; changes exactly when `subscribe` fires. */
  handlerCount(): number;
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
  const handlers = new Map<CommandId, CommandHandler>();
  const listeners = new Set<() => void>();
  const onError = deps.onError ?? ((id: CommandId, error: unknown) => console.error(`Command "${id}" failed:`, error));

  const spec = (id: CommandId): CommandSpec => {
    const found = Object.prototype.hasOwnProperty.call(specs, id) ? specs[id] : undefined;
    if (!found) throw new Error(`Unknown command id "${id}" (the ids are listed in app/src/commands/ids.ts)`);
    return found;
  };

  const isEnabled = (id: CommandId): boolean => {
    spec(id);
    const handler = handlers.get(id);
    if (!handler) return false;
    if (!handler.enabled) return true;
    const ctx = deps.context();
    try {
      return handler.enabled(ctx.store.getState(), ctx);
    } catch (error) {
      onError(id, error);
      return false;
    }
  };

  return {
    spec,

    register(id, handler) {
      spec(id);
      if (handlers.has(id)) throw new Error(`Command "${id}" already has a handler: exactly one package owns each id`);
      handlers.set(id, handler);
      for (const listener of [...listeners]) listener();
    },

    async run(id, arg) {
      spec(id);
      const handler = handlers.get(id);
      if (!handler || deps.isModalOpen() || !isEnabled(id)) return;
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
    handlerCount: () => handlers.size,
    ids: () => Object.keys(specs),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
