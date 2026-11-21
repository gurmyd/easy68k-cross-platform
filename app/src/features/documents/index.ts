// Feature "documents": documents: New, Open, Save, Close, Exit, Reload, the Window list, close prompts, drafts.
//
// STUB written by W3 (wave 0): an empty feature module, so that the shell runs before this
// feature exists (ARCHITECTURE.md 3.12.3). E1 owns this folder and replaces the body. The
// exported names and the signature of the factory are contract (section 8, "Stubs"): app/src/features/index.ts imports
// them by name.
//
// A feature module may contribute command handlers (`commands`), panels (`panels`), dialogs
// (`dialogs`) and an `init` function that runs once after every service exists.
//
// Owner: W3 > E1.

import type { AppContext, DocumentService, FeatureModule } from '../../contracts';
import { createStubDocumentService } from '../../state/stub-services';

export const feature: FeatureModule = { id: 'documents' };

/**
 * The document service of the application (3.9). Called once by the bootstrap, after `dialogs`,
 * `vfs` and `fileDialogs` exist. STUB: one in-memory document made from the template.
 */
export function createDocumentService(ctx: AppContext): DocumentService {
  return createStubDocumentService(ctx);
}
