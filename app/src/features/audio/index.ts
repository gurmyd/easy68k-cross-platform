// Feature "audio": sound.
//
// STUB written by W3 (wave 0): an empty feature module, so that the shell runs before this
// feature exists (ARCHITECTURE.md 3.12.3). SH5 owns this folder and replaces the body. The
// exported names and the signature of the factory are contract (section 8, "Stubs"): app/src/features/index.ts imports
// them by name.
//
// A feature module may contribute command handlers (`commands`), panels (`panels`), dialogs
// (`dialogs`) and an `init` function that runs once after every service exists.
//
// Owner: W3 > SH5.

import type { AppContext, AudioBackend, FeatureModule } from '../../contracts';
import { createSilentAudioBackend } from '../../state/stub-services';

export const feature: FeatureModule = { id: 'audio' };

/**
 * The audio backend of the browser (3.7), placed on the context as `devices.audio`. Called once
 * by the bootstrap. STUB: plays nothing.
 */
export function createAudioBackend(_ctx: AppContext): AudioBackend {
  return createSilentAudioBackend();
}
