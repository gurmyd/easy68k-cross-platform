// The Simulator's menu bar (ARCHITECTURE.md 1.3.4; sim-ui §3.1). Owner: W3.
//
// Menus, items and separators in the original's order: File, Search, Run, View, Options, Help.
// Commands the port added come after the original items of their menu, below a separator
// (section 1.5).

import { command, separator, type MenuTable } from './types';

/** The nine sizes of Options > Output Window Size, in order; the index is the command's argument. */
export const OUTPUT_SIZES: readonly { width: number; height: number }[] = [
  { width: 640, height: 480 },
  { width: 800, height: 600 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1280, height: 1024 },
  { width: 1440, height: 900 },
  { width: 1680, height: 1050 },
  { width: 1920, height: 1080 },
  { width: 1920, height: 1200 },
];

export const SIM_MENUS: MenuTable[] = [
  {
    id: 'simulator.file',
    caption: '&File',
    items: [
      command('sim.file.open'),
      command('sim.file.openData'),
      separator,
      command('sim.file.close'),
      separator,
      command('sim.file.printerSetup'),
      separator,
      command('sim.file.exit'),
    ],
  },
  {
    id: 'simulator.search',
    caption: '&Search',
    items: [command('sim.search.find'), separator, command('sim.search.gotoPC')],
  },
  {
    id: 'simulator.run',
    caption: '&Run',
    items: [
      command('sim.run.run'),
      separator,
      command('sim.run.runToCursor'),
      command('sim.run.autoTrace'),
      command('sim.run.stepOver'),
      command('sim.run.traceInto'),
      command('sim.run.pause'),
      separator,
      command('sim.run.rewind'),
      command('sim.run.reload'),
      separator,
      command('sim.run.logStart'),
      command('sim.run.logStop'),
    ],
  },
  {
    id: 'simulator.view',
    caption: '&View',
    items: [
      command('sim.view.output'),
      command('sim.view.memory'),
      command('sim.view.stack'),
      command('sim.view.hardware'),
      command('sim.view.breakpoints'),
      command('sim.view.easybin'),
      // added (1.5): the Log panel (docs/requests/U4-log-panel-command.md)
      separator,
      command('sim.view.log'),
      // added by the stage of additions (ARCHITECTURE-PLUS P3.1.4)
      separator,
      command('app.layout.move'),
      command('app.layout.lock'),
      command('app.layout.reset', undefined, 'Reset La&yout'),
      // added in version 1.1 (ARCHITECTURE-PLUS P9.4): the ready-made arrangements of the Simulator
      separator,
      {
        type: 'submenu',
        caption: 'Layou&ts',
        items: [
          command('sim.view.layout.classic'),
          command('sim.view.layout.wideOutput'),
          command('sim.view.layout.sideBySide'),
          command('sim.view.layout.floatingTools'),
        ],
      },
    ],
  },
  {
    id: 'simulator.options',
    caption: '&Options',
    items: [
      command('sim.options.sourceFont'),
      command('sim.options.outputFont'),
      command('sim.options.printerFont'),
      separator,
      command('sim.options.logOutput'),
      separator,
      command('sim.options.exceptions'),
      separator,
      command('sim.options.autoTrace'),
      separator,
      command('sim.options.fullscreen'),
      separator,
      command('sim.options.bitField'),
      separator,
      {
        type: 'submenu',
        caption: 'Output Window &Size',
        items: OUTPUT_SIZES.map(({ width, height }, index) => command('sim.options.size', index, `${width}x${height}`)),
      },
      command('sim.options.textWrap'),
      // added (1.5)
      separator,
      command('sim.options.transfer'),
      command('sim.options.speed'),
      // added (1.5): the desktop app's serial port map (docs/requests/DV4-serial-ports-command.md);
      // greyed in a browser, where the handler reports it disabled
      separator,
      command('sim.options.serialPorts'),
      // added by the stage of additions (ARCHITECTURE-PLUS P3.5)
      separator,
      command('app.additions.options'),
    ],
  },
  {
    id: 'simulator.help',
    caption: '&Help',
    items: [
      command('sim.help.help'),
      command('sim.help.about'),
      // added (1.5)
      separator,
      command('app.help.examples'),
      command('app.help.differences'),
    ],
  },
];
