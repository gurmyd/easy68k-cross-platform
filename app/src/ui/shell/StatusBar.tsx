// The status bar at the bottom of the window (ARCHITECTURE.md 2.1). Owner: W3.
//
// Each mode has its own. A feature fills it by contributing a PanelSpec with the id `status` for
// that mode (the simulator's run-state bar, 1.4 note 34, belongs to SH8). Until then the bar
// shows what the store already knows: in Editor mode the active document and its Modified and
// Insert/Replace states, as the original's status bar words them (editor-ui §7.2); in Simulator
// mode the run state and the option flags of section 2.3.

import { Box, type AppState, type Mode } from '../../contracts';
import { useAppState, useApplication } from '../../state/context';
import { shallowEqual } from '../../state/store';

/** The words for the simulator's state: the phase, and a halt while idle. */
export function runStateText(sim: Pick<AppState['sim'], 'phase' | 'halted'>): string {
  switch (sim.phase) {
    case 'loading':
      return 'Loading';
    case 'running':
    case 'waitDelay':
      return 'Running';
    case 'waitInput':
      return 'Waiting for input';
    case 'waitHost':
    case 'waitAlert':
      return 'Waiting';
    case 'idle':
      return sim.halted ? 'Halted' : 'Stopped';
  }
}

/** The speed setting as the status bar names it (4.5.6). */
export function speedText(speed: AppState['settings']['sim']['speed']): string {
  if (speed.mode === 'original') return 'EASy68K-like';
  if (speed.mode === 'max') return 'Maximum';
  return `${speed.instructionsPerSecond.toLocaleString('en-US')} instructions/s`;
}

function EditorStatus() {
  const cells = useAppState((state) => {
    const active = state.documents.items.find((item) => item.id === state.documents.activeId);
    return {
      name: active?.name ?? '',
      modified: active?.modified ? 'Modified' : '',
      insert: active ? (active.insertMode ? 'Insert' : 'Replace') : '',
    };
  }, shallowEqual);
  return (
    <>
      <span className="e68-statusbar__cell e68-statusbar__cell--grow">{cells.name}</span>
      <span className="e68-statusbar__cell">{cells.modified}</span>
      <span className="e68-statusbar__cell">{cells.insert}</span>
    </>
  );
}

function SimulatorStatus() {
  const { ctx } = useApplication();
  const cells = useAppState((state) => {
    // regsRevision is read so that the PC is taken again whenever the registers were refreshed.
    void state.sim.regsRevision;
    return {
      run: runStateText(state.sim),
      pc: ctx.sim.controller.snapshot.boxes[Box.PC] ?? '',
      speed: speedText(state.settings.sim.speed),
      exceptions: state.settings.sim.exceptions,
      bitField: state.settings.sim.bitField,
    };
  }, shallowEqual);
  return (
    <>
      <span className="e68-statusbar__cell">{cells.run}</span>
      <span className="e68-statusbar__cell e68-statusbar__cell--mono">PC={cells.pc}</span>
      <span className="e68-statusbar__cell">speed: {cells.speed}</span>
      <span className="e68-statusbar__cell">exceptions {cells.exceptions ? 'on' : 'off'}</span>
      <span className="e68-statusbar__cell e68-statusbar__cell--grow">bit field {cells.bitField ? 'on' : 'off'}</span>
    </>
  );
}

export function StatusBar({ mode }: { mode: Mode }) {
  const { panels } = useApplication();
  const Custom = panels.find(mode, 'status')?.component;
  return (
    <footer className="e68-statusbar" data-mode={mode} aria-label="Status bar">
      {Custom ? <Custom /> : mode === 'editor' ? <EditorStatus /> : mode === 'simulator' ? <SimulatorStatus /> : null}
    </footer>
  );
}
