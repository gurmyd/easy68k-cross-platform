// Hooks that tie shell components to the command tables and the store. Owner: W3.
//
// Whether a command is enabled or checked is decided by its handler from the application state
// (CommandHandler.enabled / checked). A component that shows commands therefore resolves its
// table inside a store selector: the selector runs on every state change, and the component
// re-renders only when the resolved result differs (the state changes many times per second while
// a program runs; menus and toolbars almost never do).

import { useCallback, useSyncExternalStore } from 'react';
import type { AppState, CommandId, Mode } from '../../contracts';
import {
  resolveMenus,
  resolveToolbar,
  type ResolveEnv,
  type ResolvedMenu,
  type ResolvedToolbarItem,
} from '../../commands/menus';
import { useAppState, useApplication } from '../../state/context';

/** Compares two resolved tables. They are small plain data, so their JSON text decides. */
function sameResolved<T>(a: T, b: T): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

function useResolveEnv(): (state: AppState) => ResolveEnv {
  const { ctx, commands } = useApplication();
  // Handlers are normally all registered before the first render; one that arrives later (a
  // feature loaded on demand), or an override of a check, makes the component resolve its table
  // again.
  const handlers = useSyncExternalStore(commands.subscribe, commands.revision, commands.revision);
  return useCallback(
    (state: AppState) => ({ os: ctx.platform.os, desktop: ctx.platform.kind === 'desktop', state, commands }),
    // `handlers` is listed so that the function, and with it the selector, changes with it.
    [ctx, commands, handlers],
  );
}

/** The menu bar of `mode` as it is right now. */
export function useResolvedMenus(mode: Mode): ResolvedMenu[] {
  const env = useResolveEnv();
  return useAppState((state) => resolveMenus(mode, env(state)), sameResolved);
}

/** The toolbar of `mode` as it is right now. */
export function useResolvedToolbar(mode: Mode): ResolvedToolbarItem[] {
  const env = useResolveEnv();
  return useAppState((state) => resolveToolbar(mode, env(state)), sameResolved);
}

/** Runs a command through the registry (which refuses while a modal dialog is open). */
export function useRunCommand(): (id: CommandId, arg?: unknown) => void {
  const { commands } = useApplication();
  return useCallback((id: CommandId, arg?: unknown) => void commands.run(id, arg), [commands]);
}
