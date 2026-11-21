// The task 58 dialog, `sim.fileDialog` (ARCHITECTURE.md 3.8.4, 3.8.5, 4.4.3). The run session opens
// it when a program calls TRAP #15 task 58; it shows the application's own file dialog (FS1's
// `file.open` / `file.save`, or the native dialog of the desktop app) with the program's title and
// filter, and closes with the chosen file, or null for Cancel. It draws nothing itself: the file
// dialog it opens is the window the student sees. While it is open the program waits (the engine's
// WaitHost state) and no command can be given (it is modal).
//
// Owner: SH6.

import { useEffect } from 'react';
import type { DialogProps, SimFileDialogProps, SimFileDialogResult } from '../../contracts';
import { useAppContext } from '../../state/context';
import { showProgramFileDialog } from './logic';

/**
 * One file dialog per request, also when React mounts the component twice (StrictMode in
 * development runs effects twice): the request object is the dialog's identity.
 */
const shown = new WeakMap<SimFileDialogProps, Promise<SimFileDialogResult>>();

export function SimFileDialog({ props, close }: DialogProps<SimFileDialogProps, SimFileDialogResult>) {
  const ctx = useAppContext();
  useEffect(() => {
    let current = true;
    let request = shown.get(props);
    if (!request) {
      request = showProgramFileDialog(ctx, props).catch((error: unknown) => {
        console.error('Simulator: the file dialog of TRAP #15 task 58 failed:', error);
        return null; // as Cancel
      });
      shown.set(props, request);
    }
    void request.then((result) => {
      if (current) close(result);
    });
    return () => {
      current = false;
    };
  }, [ctx, props, close]);
  return null;
}
