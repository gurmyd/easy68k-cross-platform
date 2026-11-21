// The EASyBIN state of one application window: the model (core/easybin) and what the original's two
// file dialogs remember between uses. Owner: B1.

import type { AppContext, VPath } from '../../contracts';
import { EasybinModel } from '../../core/easybin';

export interface EasybinSession {
  model: EasybinModel;
  /** OpenDialog->FileName: the last file opened with Open S-Record or Open Binary (both share it). */
  lastOpened: VPath | null;
  /** SaveDialog->FileName: the last name chosen in either save dialog; the next one suggests it. */
  lastSaved: VPath | null;
  /** Called by the workspace: puts the keyboard focus on the memory area (6.2, 6.3). */
  focusRows: () => void;
}

const sessions = new WeakMap<object, EasybinSession>();

export function easybinOf(ctx: AppContext): EasybinSession {
  let session = sessions.get(ctx);
  if (!session) {
    session = { model: new EasybinModel(), lastOpened: null, lastSaved: null, focusRows: () => {} };
    sessions.set(ctx, session);
  }
  return session;
}
