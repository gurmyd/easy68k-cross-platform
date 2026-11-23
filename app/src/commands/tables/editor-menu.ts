// The Editor's menu bar (ARCHITECTURE.md 1.3.1; editor-ui §2). Owner: W3.
//
// Menus, items and separators in the original's order: File, Edit, Project, Options, Window,
// Help. Commands the port added come after the original items of their menu, below a separator,
// so that the original items keep their positions (section 1.5).

import { command, separator, type MenuTable } from './types';

export const EDITOR_MENUS: MenuTable[] = [
  {
    id: 'editor.file',
    caption: '&File',
    items: [
      command('ed.file.new'),
      command('ed.file.open'),
      separator,
      command('ed.file.save'),
      command('ed.file.saveAs'),
      separator,
      command('ed.file.print'),
      command('ed.file.printerSetup'),
      separator,
      command('ed.file.close'),
      separator,
      command('ed.file.exit'),
      // added by the stage of additions (ARCHITECTURE-PLUS P3.3.3, P3.6)
      separator,
      command('ed.file.history'),
      command('app.files.trash'),
    ],
  },
  {
    id: 'editor.edit',
    caption: '&Edit',
    items: [
      command('ed.edit.undo'),
      command('ed.edit.redo'),
      separator,
      command('ed.edit.cut'),
      command('ed.edit.copy'),
      command('ed.edit.paste'),
      command('ed.edit.selectAll'),
      separator,
      command('ed.edit.comment'),
      command('ed.edit.uncomment'),
      separator,
      command('ed.edit.find'),
      command('ed.edit.findNext'),
      command('ed.edit.replace'),
    ],
  },
  {
    id: 'editor.project',
    caption: '&Project',
    // The original has a separator after this item; a trailing separator is never drawn.
    items: [command('ed.project.assemble')],
  },
  {
    id: 'editor.options',
    caption: '&Options',
    items: [
      command('ed.options.assembler'),
      separator,
      command('ed.options.editor'),
      // added (1.5)
      separator,
      command('ed.options.transfer'),
      // added by the stage of additions (ARCHITECTURE-PLUS P3.5)
      separator,
      command('app.additions.options'),
    ],
  },
  {
    id: 'editor.window',
    caption: '&Window',
    items: [
      command('ed.window.arrange'),
      command('ed.window.cascade'),
      command('ed.window.tileH'),
      command('ed.window.tileV'),
      command('ed.window.minimizeAll'),
      { type: 'documents' },
      // added by the stage of additions, after the document list (ARCHITECTURE-PLUS P3.1.4); with no
      // document open, resolveNodes drops the doubled separator.
      separator,
      command('app.layout.move'),
      command('ed.window.splitRight'),
      command('ed.window.splitDown'),
      command('ed.window.unsplit'),
      separator,
      command('app.layout.lock'),
      command('app.layout.reset'),
    ],
  },
  {
    id: 'editor.help',
    caption: '&Help',
    items: [
      command('ed.help.help'),
      separator,
      command('ed.help.about'),
      // added (1.5)
      separator,
      command('app.help.examples'),
      command('app.help.differences'),
    ],
  },
];
