// The specification of every command (ARCHITECTURE.md 3.12.2), written from sections 1.3 and 1.5.
// Owner: W3.
//
// Captions are the original's, with '&' before the access key (editor-ui §2, sim-ui §3.1, the
// EASyBIN form). Hints are the tool-tips of the original toolbars WITHOUT their shortcut
// (editor-ui §3, sim-ui §3.2); the toolbar appends the platform's shortcut (section 1.3.2). Keys
// come from tables/keys.ts. Commands that the original has no caption for (keys and added
// controls) carry a plain description.

import type { CommandSpec, Mode } from '../contracts';
import { normalizeChord, type Os } from './chords';
import { COMMAND_IDS, type KnownCommandId } from './ids';
import { DESKTOP_ONLY_ON_WINDOWS_AND_LINUX, KEYS, SUPPRESSED_BY_TASK_24, type KeyEntry } from './tables/keys';

interface Row {
  caption: string;
  kind?: CommandSpec['kind'];
  hint?: string;
  icon?: string;
}

const ROWS: Record<KnownCommandId, Row> = {
  // ---- Editor: File
  'ed.file.new': { caption: '&New X68 Source File', hint: 'New X68 Source File', icon: 'file-new' },
  'ed.file.open': { caption: '&Open File...', hint: 'Open File', icon: 'file-open' },
  'ed.file.save': { caption: '&Save', hint: 'Save File', icon: 'file-save' },
  'ed.file.saveAs': { caption: 'Save &As...' },
  'ed.file.print': { caption: '&Print', hint: 'Print', icon: 'print' },
  'ed.file.printerSetup': { caption: 'Printer Setup...' },
  'ed.file.close': { caption: 'C&lose File' },
  'ed.file.exit': { caption: 'E&xit' },
  // ---- Editor: Edit
  'ed.edit.undo': { caption: '&Undo', hint: 'Undo', icon: 'undo' },
  'ed.edit.redo': { caption: '&Redo', hint: 'Redo', icon: 'redo' },
  'ed.edit.cut': { caption: 'Cu&t', hint: 'Cut', icon: 'cut' },
  'ed.edit.copy': { caption: '&Copy', hint: 'Copy', icon: 'copy' },
  'ed.edit.paste': { caption: '&Paste', hint: 'Paste', icon: 'paste' },
  'ed.edit.selectAll': { caption: 'Select &All' },
  'ed.edit.comment': { caption: 'C&omment Selection', hint: 'Comment Selection', icon: 'comment' },
  'ed.edit.uncomment': { caption: 'Unco&mment Selection', hint: 'Uncomment Selection', icon: 'uncomment' },
  'ed.edit.find': { caption: '&Find...', hint: 'Find', icon: 'find' },
  'ed.edit.findNext': { caption: 'Find &Next' },
  'ed.edit.replace': { caption: 'Find And &Replace...' },
  // ---- Editor: Project, Options, Window, Help
  'ed.project.assemble': { caption: '&Assemble Source...', hint: 'Assemble Source', icon: 'assemble' },
  'ed.options.assembler': { caption: '&Assembler Options...' },
  'ed.options.editor': { caption: '&Editor Options...' },
  'ed.options.transfer': { caption: 'Import/Export Settings...' },
  'ed.window.arrange': { caption: '&Arrange' },
  'ed.window.cascade': { caption: '&Cascade' },
  'ed.window.tileH': { caption: 'Tile &Horizontally' },
  'ed.window.tileV': { caption: '&Tile Vertically' },
  'ed.window.minimizeAll': { caption: '&Minimize All' },
  'ed.window.select': { caption: 'Select Document', kind: 'radio' },
  'ed.help.help': { caption: 'Hel&p' },
  'ed.help.about': { caption: '&About' },
  // ---- Editor: context menus and keys
  'ed.edit.reload': { caption: '&Reload File' },
  'ed.msg.clear': { caption: '&Clear Error Messages' },
  'ed.help.context': { caption: 'Context Help' },
  'ed.edit.toggleInsert': { caption: 'Insert/Replace' },
  'ed.edit.indent': { caption: 'Indent Selection' },
  'ed.edit.outdent': { caption: 'Outdent Selection' },
  // ---- Editor: the stage of additions (ARCHITECTURE-PLUS P3.6; no keys, P1.3)
  'ed.window.splitRight': { caption: 'Split Editor &Right' },
  'ed.window.splitDown': { caption: 'Split Editor &Down' },
  'ed.window.unsplit': { caption: 'Close &Split' },
  'ed.file.history': { caption: 'Earlier &Versions...' },

  // ---- Simulator: File, Search
  'sim.file.open': { caption: '&Open...', hint: 'Open', icon: 'file-open' },
  'sim.file.openData': { caption: 'Open &Data...' },
  'sim.file.close': { caption: '&Close' },
  'sim.file.printerSetup': { caption: '&Printer Setup...' },
  'sim.file.exit': { caption: 'E&xit' },
  'sim.search.find': { caption: '&Find...' },
  'sim.search.gotoPC': { caption: '&Go to PC' },
  // ---- Simulator: Run
  'sim.run.run': { caption: '&Run', hint: 'Run', icon: 'run' },
  'sim.run.runToCursor': { caption: 'Run To &Cursor', hint: 'Run To Cursor', icon: 'run-to-cursor' },
  'sim.run.autoTrace': { caption: '&Auto Trace', hint: 'Auto Trace', icon: 'auto-trace' },
  'sim.run.stepOver': { caption: '&Step Over', hint: 'Step Over', icon: 'step-over' },
  'sim.run.traceInto': { caption: '&Trace Into', hint: 'Trace Into', icon: 'trace-into' },
  'sim.run.pause': { caption: '&Pause', hint: 'Pause', icon: 'pause' },
  'sim.run.rewind': { caption: 'R&ewind Program', hint: 'Rewind Program', icon: 'rewind' },
  'sim.run.reload': { caption: 'Re&load Program', hint: 'Reload Program', icon: 'reload' },
  'sim.run.logStart': { caption: 'L&og Start', hint: 'Log Start', icon: 'log-start' },
  'sim.run.logStop': { caption: 'Lo&g Stop', hint: 'Log Stop', icon: 'log-stop' },
  // ---- Simulator: View
  'sim.view.output': { caption: '&Output Window' },
  'sim.view.memory': { caption: '&Memory' },
  'sim.view.stack': { caption: '&Stack' },
  'sim.view.hardware': { caption: '&Hardware' },
  'sim.view.breakpoints': { caption: '&Break Points' },
  'sim.view.easybin': { caption: '&EASyBIN' },
  // added (1.5; docs/requests/U4-log-panel-command.md)
  'sim.view.log': { caption: '&Log' },
  // ---- Simulator: Options
  'sim.options.sourceFont': { caption: 'Source Window Font...' },
  'sim.options.outputFont': { caption: 'Output Window Font...' },
  'sim.options.printerFont': { caption: 'Printer Font...' },
  'sim.options.logOutput': { caption: '&Log Output...' },
  'sim.options.exceptions': { caption: '&Enable Exceptions', kind: 'check' },
  'sim.options.autoTrace': { caption: '&Auto Trace Options...' },
  'sim.options.fullscreen': { caption: '&Fullscreen Options...' },
  'sim.options.bitField': { caption: 'Enable &Bit Field Instructions', kind: 'check' },
  'sim.options.size': { caption: 'Output Window &Size', kind: 'radio' },
  'sim.options.textWrap': { caption: 'Output Window Text &Wrap', kind: 'check' },
  'sim.options.transfer': { caption: 'Import/Export Settings...' },
  'sim.options.speed': { caption: 'Execution Speed...' },
  // added (1.5; docs/requests/DV4-serial-ports-command.md): the COMn to device map of the desktop
  // app (3.3.4). Its handler (features/desktop-devices) is enabled in the desktop app only.
  'sim.options.serialPorts': { caption: 'Serial &Ports...' },
  // ---- Simulator: Help, context menu, keys, panels
  'sim.help.help': { caption: '&Sim68K Help' },
  'sim.help.about': { caption: '&About Sim68K' },
  'sim.bp.clearAllPC': { caption: 'Clear All PC Breakpoints' },
  'sim.help.context': { caption: 'Context Help' },
  'sim.panel.next': { caption: 'Next Panel' },
  'sim.cycles.clear': { caption: 'Clear Cycles' },
  'sim.output.fullscreen': { caption: 'Full Screen', icon: 'fullscreen' },
  'sim.output.paste': { caption: 'Paste' },
  'sim.output.releaseKeyboard': { caption: 'Release Keyboard' },

  // ---- EASyBIN (captions of the original form, Form1u.dfm)
  'bin.file.new': { caption: '&New' },
  'bin.file.openSrec': { caption: '&Open S-Record...' },
  'bin.file.openBinary': { caption: 'Open &Binary...' },
  'bin.file.saveSrec': { caption: 'Save S-&Record...' },
  'bin.file.saveBinary': { caption: '&Save Binary...' },
  'bin.file.exit': { caption: 'E&xit' },
  'bin.help.help': { caption: '&EASyBIN Help' },
  'bin.help.about': { caption: '&About EASyBIN' },

  // ---- Every mode (1.5)
  'app.mode.set': { caption: 'Mode', kind: 'radio' },
  'app.mode.next': { caption: 'Next Mode' },
  'app.theme.set': { caption: 'Theme', kind: 'radio' },
  'app.help.examples': { caption: 'Examples...' },
  'app.help.differences': { caption: 'Differences from EASy68K' },
  'app.window.new': { caption: 'New Window' },
  'app.files.toggle': { caption: 'Files', kind: 'check', hint: 'Files', icon: 'folder' },
  // ---- Every mode: the stage of additions (ARCHITECTURE-PLUS P3.6; no keys, P1.3)
  'app.layout.move': { caption: 'Mo&ve Panel To...' },
  'app.layout.lock': { caption: 'Loc&k Layout', kind: 'check' },
  // The Simulator's View menu shows it as 'Reset La&yout' (caption override in tables/sim-menu.ts).
  'app.layout.reset': { caption: 'R&eset Layout' },
  'app.files.trash': { caption: 'Tras&h...' },
  'app.additions.options': { caption: 'Port Ad&ditions...' },
};

function modeOf(id: KnownCommandId): Mode | 'app' {
  if (id.startsWith('ed.')) return 'editor';
  if (id.startsWith('sim.')) return 'simulator';
  if (id.startsWith('bin.')) return 'easybin';
  return 'app';
}

function normalKeys(entry: KeyEntry | undefined): CommandSpec['keys'] {
  if (!entry) return { win: [], mac: [] };
  const keys: CommandSpec['keys'] = { win: entry.win.map(normalizeChord), mac: entry.mac.map(normalizeChord) };
  if (entry.desktopOnly) keys.desktopOnly = entry.desktopOnly.map(normalizeChord);
  if (entry.notInOutput) keys.notInOutput = entry.notInOutput.map(normalizeChord);
  return keys;
}

function buildSpec(id: KnownCommandId): CommandSpec {
  const row = ROWS[id];
  const spec: CommandSpec = {
    id,
    mode: modeOf(id),
    caption: row.caption,
    kind: row.kind ?? 'action',
    keys: normalKeys(KEYS[id]),
    suppressedByTask24: SUPPRESSED_BY_TASK_24.includes(id),
  };
  if (row.hint !== undefined) spec.hint = row.hint;
  if (row.icon !== undefined) spec.icon = row.icon;
  return spec;
}

/** Every command specification, by id; chords in normal form. */
export const COMMAND_SPECS: Readonly<Record<KnownCommandId, CommandSpec>> = Object.freeze(
  Object.fromEntries(COMMAND_IDS.map((id) => [id, buildSpec(id)])) as Record<KnownCommandId, CommandSpec>,
);

const WINDOWS_AND_LINUX_ONLY: readonly string[] = DESKTOP_ONLY_ON_WINDOWS_AND_LINUX.map(normalizeChord);

/**
 * True when `chord` of command `id` acts only in the desktop app on this platform, because the
 * platform's browsers keep the key to themselves (2.9.3). Ctrl+F4 is such a chord on Windows and
 * Linux and an ordinary one on macOS.
 */
export function isDesktopOnly(id: KnownCommandId, chord: string, os: Os): boolean {
  if (!COMMAND_SPECS[id].keys.desktopOnly?.includes(chord)) return false;
  return !(os === 'mac' && WINDOWS_AND_LINUX_ONLY.includes(chord));
}

/**
 * The chords of command `id` that act on this platform, in the order of the key table: the list
 * of the platform's key map, in a browser without the desktop-only chords. The first is the one
 * that menus and tool-tips show. The dispatcher and the menus both ask here, so they cannot
 * disagree about a chord.
 */
export function chordsOn(id: KnownCommandId, os: Os, desktop: boolean): string[] {
  const keys = COMMAND_SPECS[id].keys;
  return (os === 'mac' ? keys.mac : keys.win).filter((chord) => desktop || !isDesktopOnly(id, chord, os));
}

/** The ids in the order of the key table first, for commands that share a chord (F1). */
export const KEY_ORDER: readonly KnownCommandId[] = [
  ...(Object.keys(KEYS) as KnownCommandId[]),
  ...COMMAND_IDS.filter((id) => !(id in KEYS)),
];
