// Every command id of the application (ARCHITECTURE.md 1.3, 1.5, 3.12.2). Owner: W3.
//
// An id names one command of one mode: `ed.` = Editor, `sim.` = Simulator, `bin.` = EASyBIN,
// `app.` = every mode. The specification of each command (caption, keys, icon) is in specs.ts and
// tables/keys.ts; the menus and toolbars that show it are in tables/. Feature packages register
// the handlers (features/<name>/index.ts); section 9.7 of the architecture document says which
// package owns which id.

export const COMMAND_IDS = [
  // Editor - menus (1.3.1)
  'ed.file.new',
  'ed.file.open',
  'ed.file.save',
  'ed.file.saveAs',
  'ed.file.print',
  'ed.file.printerSetup',
  'ed.file.close',
  'ed.file.exit',
  'ed.edit.undo',
  'ed.edit.redo',
  'ed.edit.cut',
  'ed.edit.copy',
  'ed.edit.paste',
  'ed.edit.selectAll',
  'ed.edit.comment',
  'ed.edit.uncomment',
  'ed.edit.find',
  'ed.edit.findNext',
  'ed.edit.replace',
  'ed.project.assemble',
  'ed.options.assembler',
  'ed.options.editor',
  'ed.options.transfer',
  'ed.window.arrange',
  'ed.window.cascade',
  'ed.window.tileH',
  'ed.window.tileV',
  'ed.window.minimizeAll',
  'ed.window.select',
  'ed.help.help',
  'ed.help.about',
  // Editor - context menus and keys (1.3.2)
  'ed.edit.reload',
  'ed.msg.clear',
  'ed.help.context',
  'ed.edit.toggleInsert',
  'ed.edit.indent',
  'ed.edit.outdent',
  // Editor - the stage of additions (ARCHITECTURE-PLUS P3.6)
  'ed.window.splitRight',
  'ed.window.splitDown',
  'ed.window.unsplit',
  'ed.file.history',

  // Simulator - menus (1.3.4)
  'sim.file.open',
  'sim.file.openData',
  'sim.file.close',
  'sim.file.printerSetup',
  'sim.file.exit',
  'sim.search.find',
  'sim.search.gotoPC',
  'sim.run.run',
  'sim.run.runToCursor',
  'sim.run.autoTrace',
  'sim.run.stepOver',
  'sim.run.traceInto',
  'sim.run.pause',
  'sim.run.rewind',
  'sim.run.reload',
  'sim.run.logStart',
  'sim.run.logStop',
  'sim.view.output',
  'sim.view.memory',
  'sim.view.stack',
  'sim.view.hardware',
  'sim.view.breakpoints',
  'sim.view.easybin',
  'sim.view.log',
  'sim.options.sourceFont',
  'sim.options.outputFont',
  'sim.options.printerFont',
  'sim.options.logOutput',
  'sim.options.exceptions',
  'sim.options.autoTrace',
  'sim.options.fullscreen',
  'sim.options.bitField',
  'sim.options.size',
  'sim.options.textWrap',
  'sim.options.transfer',
  'sim.options.speed',
  'sim.options.serialPorts',
  'sim.help.help',
  'sim.help.about',
  // Simulator - context menu, keys, panels (1.3.5, 1.3.6)
  'sim.bp.clearAllPC',
  'sim.help.context',
  'sim.panel.next',
  'sim.cycles.clear',
  'sim.output.fullscreen',
  'sim.output.paste',
  'sim.output.releaseKeyboard',

  // EASyBIN (1.3.8; B1 extends this list with its specification)
  'bin.file.new',
  'bin.file.openSrec',
  'bin.file.openBinary',
  'bin.file.saveSrec',
  'bin.file.saveBinary',
  'bin.file.exit',
  'bin.help.help',
  'bin.help.about',

  // Every mode (1.5)
  'app.mode.set',
  'app.mode.next',
  'app.theme.set',
  'app.help.examples',
  'app.help.differences',
  'app.window.new',
  'app.files.toggle',
  // Every mode - the stage of additions (ARCHITECTURE-PLUS P3.6)
  'app.layout.move',
  'app.layout.lock',
  'app.layout.reset',
  'app.files.trash',
  'app.additions.options',
  // Every mode - version 1.1, arranging panels freely (ARCHITECTURE-PLUS P9.5; M1)
  'app.layout.float',
  'app.layout.dock',
  // Simulator - version 1.1: View > Layouts, the ready-made arrangements (ARCHITECTURE-PLUS P9.4, P9.5; M2)
  'sim.view.layout.classic',
  'sim.view.layout.wideOutput',
  'sim.view.layout.sideBySide',
  'sim.view.layout.floatingTools',
] as const;

/** The union of the ids above. `CommandId` of the contracts is `string`; use this where a typo should not compile. */
export type KnownCommandId = (typeof COMMAND_IDS)[number];

const KNOWN: ReadonlySet<string> = new Set(COMMAND_IDS);

export function isCommandId(id: string): id is KnownCommandId {
  return KNOWN.has(id);
}
