// The feature list (ARCHITECTURE.md 3.12.3): 24 features in the documented order, one folder
// each, each exporting a FeatureModule named `feature` with the folder's name as its id.

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FEATURES, FEATURE_NAMES, SERVICE_FACTORIES } from './index';

const here = fileURLToPath(new URL('.', import.meta.url));

describe('features/index.ts', () => {
  it('lists the 24 features in the order of 3.12.3', () => {
    expect(FEATURE_NAMES).toEqual([
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
    ]);
    expect(FEATURES).toHaveLength(24);
    // The id of a feature module is the name of its folder.
    expect(FEATURES.map((feature) => feature.id)).toEqual([...FEATURE_NAMES]);
  });

  it('has exactly one folder per feature', () => {
    const folders = readdirSync(here, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(folders.sort()).toEqual([...FEATURE_NAMES].sort());
  });

  it('takes the four service factories from the features under their fixed names', () => {
    expect(Object.keys(SERVICE_FACTORIES).sort()).toEqual([
      'createAudioBackend',
      'createDocumentService',
      'createFileDialogs',
      'createSimSession',
    ]);
    for (const factory of Object.values(SERVICE_FACTORIES)) expect(factory).toBeTypeOf('function');
  });
});
