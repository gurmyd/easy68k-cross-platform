// The EASyBIN menu bar (ARCHITECTURE.md 1.3.8). First version by W3; owner from wave 2 on: B1.
//
// No porting specification exists for EASyBIN yet (B1 writes docs/porting/easybin.md first). This
// table is the File menu of section 1.3.8 with the captions, separators and order of the original
// form (reference/src-easybin/EASyBINv2.5.0/Form1u.dfm): New | Open S-Record, Open Binary |
// Save S-Record, Save Binary | Exit; and the original's Help menu (EASyBIN Help, About EASyBIN)
// followed by the two items the port adds to every Help menu (section 1.5).

import { command, separator, type MenuTable } from './types';

export const EASYBIN_MENUS: MenuTable[] = [
  {
    id: 'easybin.file',
    caption: '&File',
    items: [
      command('bin.file.new'),
      separator,
      command('bin.file.openSrec'),
      command('bin.file.openBinary'),
      separator,
      command('bin.file.saveSrec'),
      command('bin.file.saveBinary'),
      separator,
      command('bin.file.exit'),
    ],
  },
  {
    id: 'easybin.help',
    caption: '&Help',
    items: [
      command('bin.help.help'),
      command('bin.help.about'),
      // added (1.5)
      separator,
      command('app.help.examples'),
      command('app.help.differences'),
    ],
  },
];
