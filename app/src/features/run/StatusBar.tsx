// The status bar of Simulator mode (ARCHITECTURE.md 2.3, 1.4 note 34): run state, PC, speed
// setting and the two option flags. The shell puts this component into its status bar; the cells
// use the shell's cell classes (ui/shell/shell.css), as the placeholder they replace does.
//
// Owner: SH8.

import { useEffect, useState } from 'react';
import { Box } from '../../contracts';
import { useAppContext, useAppState } from '../../state/context';
import { shallowEqual } from '../../state/store';
import { RunAnnouncer } from './announce';
import { runSessionOf } from './session';
import { statusCells } from './status';

/**
 * The hidden polite region that tells a screen reader the settled run states: a halt, a stop, the
 * start and end of Auto Trace (2.11; announce.ts; errata SH8.md entry 43). Each announcement is a
 * new element, so that the same words said twice (two halts) are read twice.
 */
function RunAnnouncement() {
  const ctx = useAppContext();
  const [said, setSaid] = useState({ text: '', seq: 0 });
  useEffect(() => {
    const session = runSessionOf(ctx.sim);
    if (!session) return undefined; // a stand-in session: nothing runs
    const { controller } = session;
    const announcer = new RunAnnouncer({
      read: () => ({ stop: controller.lastStop, sim: ctx.store.getState().sim }),
      now: () => performance.now(),
      setTimer: (fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      },
      say: (text) => setSaid((previous) => ({ text, seq: previous.seq + 1 })),
    });
    const stopStore = ctx.store.subscribe(() => announcer.update());
    const stopController = controller.subscribe(() => announcer.update());
    return () => {
      stopStore();
      stopController();
      announcer.dispose();
    };
  }, [ctx]);
  return (
    <span className="e68-sr" role="status" data-e68-run-announce="">
      {said.text === '' ? null : <span key={said.seq}>{said.text}</span>}
    </span>
  );
}

export function SimStatusBar() {
  const ctx = useAppContext();
  const cells = useAppState((state) => {
    // The PC is not in the store: it is read from the snapshot, which `regsRevision` announces.
    void state.sim.regsRevision;
    return statusCells(state, ctx.sim.controller.snapshot.boxes[Box.PC] ?? '');
  }, shallowEqual);
  return (
    <>
      {/* The visible cell is not a live region: it passes through Running and Waiting at every input
          or host wait. RunAnnouncement says the settled states (review of f17e78a). */}
      <span className="e68-statusbar__cell" data-e68-status="run">
        {cells.run}
      </span>
      <RunAnnouncement />
      <span className="e68-statusbar__cell e68-statusbar__cell--mono" data-e68-status="pc">
        {cells.pc}
      </span>
      <span className="e68-statusbar__cell" data-e68-status="speed">
        {cells.speed}
      </span>
      <span className="e68-statusbar__cell" data-e68-status="exceptions">
        {cells.exceptions}
      </span>
      <span className="e68-statusbar__cell e68-statusbar__cell--grow" data-e68-status="bitField">
        {cells.bitField}
      </span>
    </>
  );
}
