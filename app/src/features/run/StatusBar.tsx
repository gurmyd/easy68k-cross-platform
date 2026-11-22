// The status bar of Simulator mode (ARCHITECTURE.md 2.3, 1.4 note 34): run state, PC, speed
// setting and the two option flags. The shell puts this component into its status bar; the cells
// use the shell's cell classes (ui/shell/shell.css), as the placeholder they replace does.
//
// Owner: SH8.

import { Box } from '../../contracts';
import { useAppContext, useAppState } from '../../state/context';
import { shallowEqual } from '../../state/store';
import { statusCells } from './status';

export function SimStatusBar() {
  const ctx = useAppContext();
  const cells = useAppState((state) => {
    // The PC is not in the store: it is read from the snapshot, which `regsRevision` announces.
    void state.sim.regsRevision;
    return statusCells(state, ctx.sim.controller.snapshot.boxes[Box.PC] ?? '');
  }, shallowEqual);
  return (
    <>
      {/* A polite live region (2.11: "a halt ... announced"; finding Q1-5 of docs/integration/rc.md):
          Halted, Stopped, Running and the other run states are told when they change. */}
      <span className="e68-statusbar__cell" data-e68-status="run" role="status">
        {cells.run}
      </span>
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
