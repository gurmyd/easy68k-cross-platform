// The message boxes of the engine (ARCHITECTURE.md 4.4.4): `Current Log Stopped.`, the internal
// fault box, `Breakpoint Limit Reached!`, the Run To Cursor boxes.
//
// The run controller keeps the open boxes in `controller.alerts`, oldest first, and executes
// nothing while the list is not empty. This presenter shows them, one modal message box after the
// other with an OK button as in the original, and calls `controller.dismissAlerts()` when the
// user has closed the last one.
//
// Owner: SH8.

import type { DialogService, PendingAlert, RunController } from '../../contracts';

export interface AlertPresenterDeps {
  controller: Pick<RunController, 'alerts' | 'subscribe' | 'dismissAlerts'>;
  dialogs: Pick<DialogService, 'messageBox'>;
  report?: (error: unknown) => void;
}

/** Starts showing the controller's boxes; the returned function stops it. */
export function presentAlerts(deps: AlertPresenterDeps): () => void {
  const { controller, dialogs } = deps;
  let showing = false;
  let stopped = false;

  /** The boxes the user has seen and closed. A box is the same object for as long as it is open. */
  const closed = new WeakSet<PendingAlert>();

  const show = async (): Promise<void> => {
    if (showing || stopped) return;
    showing = true;
    try {
      // Boxes may be added while one is open: go on until every box of the list has been shown.
      for (;;) {
        const box = controller.alerts.find((alert) => !closed.has(alert));
        if (!box || stopped) break;
        // The original's boxes are plain MB_OK boxes: no icon. The open box itself keeps the program
        // from executing, so the dialog service need not hold the controller as well.
        await dialogs.messageBox(
          { title: box.title, text: box.text, icon: 'none', buttons: ['OK'] },
          { holdsProgram: false },
        );
        closed.add(box);
      }
      if (controller.alerts.length > 0 && !stopped) controller.dismissAlerts();
    } catch (error) {
      deps.report?.(error);
    } finally {
      showing = false;
    }
    // A box that the dismissal itself raised: the program ran on and met the next one.
    if (controller.alerts.length > 0 && !stopped) void show();
  };

  const unsubscribe = controller.subscribe(() => {
    if (controller.alerts.length > 0) void show();
  });
  if (controller.alerts.length > 0) void show();
  return () => {
    stopped = true;
    unsubscribe();
  };
}
