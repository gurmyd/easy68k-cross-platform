// The toolbars (ARCHITECTURE.md 1.3.2, 1.3.5; editor-ui §3, sim-ui §3.2). Owner: W3.
//
// Editor: the original's 13 buttons and 6 separators in the original's order, preceded by the
// port's Files button (section 1.5: "button at the left of the editor toolbar").
// Simulator: the original's 11 buttons and the LOGGING label, with the original's separators.
// EASyBIN has no toolbar in the original.

import type { Mode } from '../../contracts';
import type { ToolbarNode } from './types';

const button = (id: Extract<ToolbarNode, { type: 'command' }>['id']): ToolbarNode => ({ type: 'command', id });
const separator: ToolbarNode = { type: 'separator' };

export const EDITOR_TOOLBAR: ToolbarNode[] = [
  // added (1.5)
  button('app.files.toggle'),
  separator,
  // the original toolbar
  button('ed.file.new'),
  separator,
  button('ed.file.open'),
  button('ed.file.save'),
  button('ed.file.print'),
  separator,
  button('ed.edit.find'),
  separator,
  button('ed.edit.cut'),
  button('ed.edit.copy'),
  button('ed.edit.paste'),
  separator,
  button('ed.edit.undo'),
  button('ed.edit.redo'),
  separator,
  button('ed.edit.comment'),
  button('ed.edit.uncomment'),
  separator,
  button('ed.project.assemble'),
];

export const SIM_TOOLBAR: ToolbarNode[] = [
  button('sim.file.open'),
  separator,
  button('sim.run.run'),
  separator,
  button('sim.run.runToCursor'),
  button('sim.run.autoTrace'),
  button('sim.run.stepOver'),
  button('sim.run.traceInto'),
  button('sim.run.pause'),
  separator,
  button('sim.run.rewind'),
  separator,
  button('sim.run.reload'),
  separator,
  button('sim.run.logStart'),
  button('sim.run.logStop'),
  { type: 'logging' },
];

export const EASYBIN_TOOLBAR: ToolbarNode[] = [];

export const TOOLBARS: Record<Mode, ToolbarNode[]> = {
  editor: EDITOR_TOOLBAR,
  simulator: SIM_TOOLBAR,
  easybin: EASYBIN_TOOLBAR,
};

/**
 * The five commands that stay disabled after a halt. Their tool-tip then explains why (section
 * 1.4 note 22).
 */
export const HALTED_HINT = 'Program halted. Rewind or Reload to run it again.';
export const DISABLED_BY_HALT: readonly string[] = [
  'sim.run.run',
  'sim.run.runToCursor',
  'sim.run.autoTrace',
  'sim.run.stepOver',
  'sim.run.traceInto',
];
