// The EASyBIN menu bar (ARCHITECTURE.md 1.3.8; docs/porting/easybin.md section 2). First version by
// W3; owner from wave 2 on: B1.
//
// The original's two menus with the captions, separators and order of its form (Form1u.dfm,
// MainMenu1): File = New | Open S-Record, Open Binary | Save S-Record, Save Binary | Exit; Help =
// EASyBIN Help, About EASyBIN, followed by the two items the port adds to every Help menu (section
// 1.5). Captions and shortcuts are in specs.ts and tables/keys.ts (W3): Ctrl+O, Ctrl+B, Ctrl+R, Ctrl+S.

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
