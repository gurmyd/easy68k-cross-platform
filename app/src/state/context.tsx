// The running application as React components see it. Owner: W3.
//
// bootstrap() (app/src/bootstrap.ts) builds one `Application` per window: the AppContext of the
// contracts (store, commands, settings, dialogs, platform, files, documents, engines) plus what
// the shell needs to draw (the panels and dialogs the features contributed). `ApplicationProvider`
// makes it available to the component tree; panels and dialogs of feature packages use:
//
//   const ctx = useAppContext();                       // services
//   const mode = useAppState((state) => state.mode);   // re-renders when the mode changes
//
// Components never import a service from another feature; they take it from the context (3.1).

import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { AppContext, AppState, DialogProps, Store } from '../contracts';
import type { CommandRegistryStore } from '../commands/registry';
import type { DialogServiceStore } from './dialogs';
import type { PanelRegistry } from './panels';
import type { ShellState } from './shell';
import { useStoreValue } from './store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dialogs of every props and result type (3.12.3)
export type DialogComponent = ComponentType<DialogProps<any, any>>;

/** Everything bootstrap() creates for one window. */
export interface Application {
  readonly ctx: AppContext;
  /** `ctx.commands` with the members the shell uses beyond the contract. */
  readonly commands: CommandRegistryStore;
  /** `ctx.dialogs` with the members the dialog host uses beyond the contract. */
  readonly dialogs: DialogServiceStore;
  readonly panels: PanelRegistry;
  /** The dialog components the features registered, by dialog id. */
  readonly dialogComponents: ReadonlyMap<string, DialogComponent>;
  readonly shell: Store<ShellState>;
  /** Alt+letter (Windows, Linux): the menu bar puts its "open the menu with this access key" here. */
  readonly menuAccess: { open: ((letter: string) => boolean) | null };
  /** Resolves true once this window holds its Web Lock (3.8.6); false where locks do not exist. */
  readonly windowLock: Promise<boolean>;
  /** Ends the window: listeners removed, the window lock released, feature disposers called. */
  dispose(): void;
}

const ApplicationContext = createContext<Application | null>(null);

export function ApplicationProvider({ app, children }: { app: Application; children: ReactNode }) {
  return <ApplicationContext.Provider value={app}>{children}</ApplicationContext.Provider>;
}

export function useApplication(): Application {
  const app = useContext(ApplicationContext);
  if (!app) throw new Error('No application: the component is not inside <ApplicationProvider>');
  return app;
}

/** The services of the application (3.12.3). */
export function useAppContext(): AppContext {
  return useApplication().ctx;
}

/**
 * A part of the application state (3.12.1). The component re-renders only when the selected part
 * changes; pass `isEqual` (for example shallowEqual of state/store.ts) when the selector builds a
 * new object or array on every call.
 */
export function useAppState<T>(selector: (state: AppState) => T, isEqual?: (a: T, b: T) => boolean): T {
  return useStoreValue(useApplication().ctx.store, selector, isEqual);
}

/** A part of the shell's own state (state/shell.ts). */
export function useShellState<T>(selector: (state: ShellState) => T, isEqual?: (a: T, b: T) => boolean): T {
  return useStoreValue(useApplication().shell, selector, isEqual);
}
