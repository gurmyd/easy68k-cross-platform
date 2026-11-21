// The dialog service (ARCHITECTURE.md 2.7, 3.12.4, 4.4.5). Owner: W3.
//
// Features open dialogs by id; the shell's dialog host (ui/shell/DialogHost.tsx) draws the open
// ones from AppState.dialogs.stack. A dialog is a React component that a feature registers under
// its id (FeatureModule.dialogs); it receives its `props` and a `close(result)` function, and the
// promise returned by `open` resolves with that result. Message boxes need no component of their
// own: `messageBox` resolves to the caption of the pressed button.
//
// Two rules of the original are kept here, in one place:
//
// - While a MODAL dialog is open no command can be given (2.9.1): `isModalOpen()` is what the
//   command registry asks. It is true from the moment `open` is called.
// - A modal dialog opened from SIMULATOR mode holds the run controller for as long as it is open
//   (4.4.5): the original's program stands still inside the dialog's message loop, and a log or a
//   delay can depend on that. Modeless dialogs and the dialogs of Editor mode do not hold it.

import type { AppState, DialogInstance, DialogService, MessageBoxRequest, RunController, Store } from '../contracts';
import { createStore } from './store';

/** The dialog id of message boxes (2.7). */
export const MESSAGE_DIALOG_ID = 'message';

export interface ToastEntry {
  id: number;
  text: string;
  action?: { label: string; run(): void };
}

/** The service plus what the dialog host uses. */
export interface DialogServiceStore extends DialogService {
  /** Closes an open dialog and resolves its promise. A second call for the same key does nothing. */
  close(key: number, result: unknown): void;
  /** The toasts on screen, oldest first. */
  readonly toasts: Store<readonly ToastEntry[]>;
  dismissToast(id: number): void;
}

export interface DialogDeps {
  store: Store<AppState>;
  /** The run controller to hold (4.4.5); null while the simulator session does not exist yet. */
  controller: () => Pick<RunController, 'hold'> | null;
  /** True when a component is registered for the dialog id. */
  hasDialog: (id: string) => boolean;
}

interface Pending {
  resolve: (result: unknown) => void;
  release: (() => void) | undefined;
}

export function createDialogService(deps: DialogDeps): DialogServiceStore {
  const { store } = deps;
  const pending = new Map<number, Pending>();
  const toasts = createStore<readonly ToastEntry[]>([]);
  let nextKey = 1;
  let nextToast = 1;

  const setStack = (change: (stack: DialogInstance[]) => DialogInstance[]) =>
    store.setState((state) => ({ ...state, dialogs: { ...state.dialogs, stack: change(state.dialogs.stack) } }));

  const open = <P, R>(id: string, props: P, options?: { modal?: boolean; holdsProgram?: boolean }): Promise<R> => {
    if (id !== MESSAGE_DIALOG_ID && !deps.hasDialog(id)) {
      return Promise.reject(new Error(`No dialog is registered for the id "${id}" (FeatureModule.dialogs)`));
    }
    const modal = options?.modal ?? true;
    const holds = options?.holdsProgram ?? (modal && store.getState().mode === 'simulator');
    const key = nextKey++;
    const release = holds ? deps.controller()?.hold() : undefined;
    return new Promise<R>((resolve) => {
      pending.set(key, { resolve: resolve as (result: unknown) => void, release });
      setStack((stack) => [...stack, { key, id, props, modal }]);
    });
  };

  return {
    open,

    messageBox(request: MessageBoxRequest, options) {
      return open<MessageBoxRequest, string>(
        MESSAGE_DIALOG_ID,
        request,
        options?.holdsProgram === undefined ? { modal: true } : { modal: true, holdsProgram: options.holdsProgram },
      );
    },

    toast(text, action) {
      const entry: ToastEntry = action ? { id: nextToast++, text, action } : { id: nextToast++, text };
      toasts.setState((list) => [...list, entry]);
    },

    isModalOpen: () => store.getState().dialogs.stack.some((dialog) => dialog.modal),

    close(key, result) {
      const entry = pending.get(key);
      if (!entry) return;
      pending.delete(key);
      setStack((stack) => stack.filter((dialog) => dialog.key !== key));
      entry.release?.();
      entry.resolve(result);
    },

    toasts,
    dismissToast(id) {
      toasts.setState((list) =>
        list.some((toast) => toast.id === id) ? list.filter((toast) => toast.id !== id) : list,
      );
    },
  };
}
