// The texts of the simulator's status bar (ARCHITECTURE.md 2.3, 1.4 note 34).
//
// The original's status bar is two panels that never show anything; the port uses the place for
// the run state, the PC, the speed setting and the two option flags:
//
//   Stopped   PC=00001004   speed: EASy68K-like   exceptions off   bit field off
//
// Owner: SH8.

import type { AppState, SimSettings } from '../../contracts';

/** The words for the simulator's state. */
export function runStateText(sim: Pick<AppState['sim'], 'phase' | 'halted' | 'autoTrace'>): string {
  switch (sim.phase) {
    case 'loading':
      return 'Loading';
    case 'running':
    case 'waitDelay': // a task 23 delay is part of the program running
      return 'Running';
    case 'waitInput':
      return 'Waiting for input';
    case 'waitHost':
    case 'waitAlert':
      return 'Waiting';
    case 'idle':
      // Auto Trace executes one instruction per timer tick; between two ticks the simulator is idle.
      if (sim.autoTrace) return 'Auto trace';
      return sim.halted ? 'Halted' : 'Stopped';
  }
}

/** The speed setting as the status bar and the Execution Speed dialog name it (4.5.6). */
export function speedText(speed: SimSettings['speed']): string {
  if (speed.mode === 'original') return 'EASy68K-like';
  if (speed.mode === 'max') return 'Maximum';
  return `${speed.instructionsPerSecond.toLocaleString('en-US')} instructions/s`;
}

export interface StatusCells {
  run: string;
  pc: string;
  speed: string;
  exceptions: string;
  bitField: string;
}

/** The five cells of the status bar. `pc` is the text of the PC box of the last snapshot. */
export function statusCells(state: Pick<AppState, 'sim' | 'settings'>, pc: string): StatusCells {
  return {
    run: runStateText(state.sim),
    pc: `PC=${pc}`,
    speed: `speed: ${speedText(state.settings.sim.speed)}`,
    exceptions: `exceptions ${state.settings.sim.exceptions ? 'on' : 'off'}`,
    bitField: `bit field ${state.settings.sim.bitField ? 'on' : 'off'}`,
  };
}
