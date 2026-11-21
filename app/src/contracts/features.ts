// Contract: feature modules, the application context and dialogs (ARCHITECTURE.md 3.12.3, 3.12.4).
// Implemented by W3 (bootstrap, features/index.ts, the dialog host) and the feature packages.
//
// Owner: W1. Contracts import nothing but other contracts (3.1). The two outside types this file
// needs are therefore reached without an import:
//   - React.ComponentType through the global `React` namespace that @types/react declares (the
//     reference directive below loads it; it is a type-only reference, not an import);
//   - CodeMirror's Extension as `Extension` below, a structural copy of @codemirror/state's type,
//     so that values of either type are assignable to the other.

/// <reference types="react" />

import type { CommandHandler, CommandId, CommandRegistry } from './commands';
import type { AudioBackend, Clock, Scheduler } from './devices';
import type { DocumentService, DocumentState } from './documents';
import type { AsmEngine } from './engine';
import type { FileDialogs, Vfs } from './fs';
import type { Platform } from './platform';
import type { SimSession } from './run';
import type { SettingsService } from './settings';
import type { AppState, Mode, Store } from './store';

/** @codemirror/state's `Extension`, structurally: `{ extension: Extension } | readonly Extension[]`. */
export type Extension = { extension: Extension } | readonly Extension[];

export interface AppContext {
  store: Store<AppState>;
  commands: CommandRegistry;
  settings: SettingsService;
  dialogs: DialogService;
  platform: Platform;
  vfs: Vfs;
  fileDialogs: FileDialogs;
  documents: DocumentService;
  asm: AsmEngine;
  /** Devices that exist only in a browser; the simulator session takes them from here (3.3.1). */
  devices: { audio: AudioBackend };
  sim: SimSession;
  clock: Clock;
  scheduler: Scheduler;
  /** Editor extensions contributed by other features (highlighting, markers). The editor component
   *  applies every registered source to every document view. Extension is @codemirror/state's type. */
  editorExtensions: { register(source: (doc: DocumentState) => Extension): () => void };
}
export interface PanelSpec {
  id: string;
  title: string;
  mode: Mode;
  component: React.ComponentType;
}
export interface FeatureModule {
  id: string;
  commands?: Record<CommandId, CommandHandler>;
  panels?: PanelSpec[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a module lists dialogs of every props/result type (3.12.3)
  dialogs?: Record<string, React.ComponentType<DialogProps<any, any>>>;
  /** Called once after every service exists. May return a dispose function. */
  init?(ctx: AppContext): void | (() => void);
}

/* ------------------------------------------------------------------ dialogs (3.12.4) */

export interface DialogProps<P, R> {
  props: P;
  close(result: R): void;
}
export interface DialogInstance {
  key: number;
  id: string;
  props: unknown;
  modal: boolean;
}
export interface MessageBoxRequest {
  title: string;
  text: string;
  icon: 'none' | 'information' | 'confirmation' | 'warning' | 'error';
  buttons: ('OK' | 'Cancel' | 'Yes' | 'No' | 'Replace' | 'Append')[];
}
export interface DialogService {
  /** holdsProgram: hold the run controller while the dialog is open (4.4.5). Default: true for a
   *  modal dialog opened while the mode is 'simulator', false otherwise. */
  open<P, R>(id: string, props: P, options?: { modal?: boolean; holdsProgram?: boolean }): Promise<R>;
  messageBox(request: MessageBoxRequest, options?: { holdsProgram?: boolean }): Promise<string>; // resolves to the button caption
  toast(text: string, action?: { label: string; run(): void }): void;
  isModalOpen(): boolean;
}
