// The texts of the simulator's status bar (ARCHITECTURE.md 2.3, 1.4 note 34).
//
// The original's status bar is two panels that never show anything; the port uses the place for
// the run state, the PC, the speed setting and the two option flags:
//
//   Stopped   PC=00001004   speed: EASy68K-like   exceptions off   bit field off
//
// Owner: SH8.

import type { AppState, SimSettings } from '../../contracts';

/**
 * The words for the simulator's state.
 *
 * `halted` is the engine's raw halt flag, which stays set from SIMHALT until the next run starts:
 * Rewind, Open and Pause leave it set (sim-ui §9.9) but put the commands back into the active
 * state (sim-ui §3.6), and from then on Run is enabled. So the bar says Halted only while the
 * commands are busy because of the halt (`menuState` 1); afterwards it says Stopped. A caller
 * that passes no `menuState` gets the busy reading.
 */
export function runStateText(
  sim: Pick<AppState['sim'], 'phase' | 'halted' | 'autoTrace'> & Partial<Pick<AppState['sim'], 'menuState'>>,
): string {
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
      return sim.halted && sim.menuState !== 0 ? 'Halted' : 'Stopped';
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
