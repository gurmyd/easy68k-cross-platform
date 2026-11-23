// Every feature module of the application, by a fixed import (ARCHITECTURE.md 3.12.3). Owner: W3.
//
// A feature is a folder app/src/features/<name>/ owned by one work package. Its `index.ts` exports
// `feature`, a FeatureModule: command handlers, panels, dialogs and an `init` function. Four
// features also provide a service of the AppContext through a factory with a fixed name. The
// shell (ui/shell) and the bootstrap reach features only through this file (3.1).
//
// The order below is the order of 3.12.3. It is the order in which commands, panels and dialogs
// are registered and in which `init` runs.

import type { FeatureModule } from '../contracts';
import type { ServiceFactories } from '../state/services';
import { createHistoryService, browserHistoryDeps } from '../fs/history-db';
import { feature as additions } from './additions';
import { feature as assemble } from './assemble';
import { createAudioBackend, feature as audio } from './audio';
import { feature as breakpoints } from './breakpoints';
import { feature as desktopDevices } from './desktop-devices';
import { createDocumentService, feature as documents } from './documents';
import { feature as easybin } from './easybin';
import { feature as editor } from './editor';
import { createFileDialogs, feature as files } from './files';
import { feature as filesFsaccess } from './files-fsaccess';
import { feature as find } from './find';
import { feature as hardware } from './hardware';
import { feature as help } from './help';
import { feature as highlight } from './highlight';
import { feature as history } from './history';
import { feature as layout } from './layout';
import { feature as log } from './log';
import { feature as memory } from './memory';
import { feature as options } from './options';
import { feature as output } from './output';
import { feature as print } from './print';
import { feature as pwa } from './pwa';
import { feature as reloadOffer } from './reload-offer';
import { createSimSession, feature as run } from './run';
import { feature as simFiles } from './sim-files';
import { feature as simMain } from './sim-main';
import { feature as simOptions } from './sim-options';
import { feature as stack } from './stack';
import { createViewerService, feature as viewer } from './viewer';

/** The 29 features: the 24 of 3.12.3 in its order, then the five of the stage of additions (ARCHITECTURE-PLUS P5 N0). */
export const FEATURES: readonly FeatureModule[] = [
  documents,
  editor,
  highlight,
  options,
  assemble,
  find,
  print,
  files,
  filesFsaccess,
  help,
  run,
  simMain,
  output,
  memory,
  stack,
  hardware,
  breakpoints,
  log,
  simOptions,
  simFiles,
  audio,
  desktopDevices,
  easybin,
  pwa,
  // the stage of additions
  layout,
  history,
  viewer,
  additions,
  reloadOffer,
];

/** The folder names of the features, in the same order (a test compares them with the folders). */
export const FEATURE_NAMES = [
  'documents',
  'editor',
  'highlight',
  'options',
  'assemble',
  'find',
  'print',
  'files',
  'files-fsaccess',
  'help',
  'run',
  'sim-main',
  'output',
  'memory',
  'stack',
  'hardware',
  'breakpoints',
  'log',
  'sim-options',
  'sim-files',
  'audio',
  'desktop-devices',
  'easybin',
  'pwa',
  'layout',
  'history',
  'viewer',
  'additions',
  'reload-offer',
] as const;

/** The services that features provide (3.12.3), and the history of fs/history-db.ts (ARCHITECTURE-PLUS P4.4). */
export const SERVICE_FACTORIES: ServiceFactories = {
  createFileDialogs,
  createDocumentService,
  createAudioBackend,
  createSimSession,
  // ARCHITECTURE-PLUS P4.4
  createHistoryService: (ctx) => createHistoryService(browserHistoryDeps(ctx)),
  createViewerService,
};
