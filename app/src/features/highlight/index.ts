// Feature "highlight": syntax highlighting of source documents (ARCHITECTURE.md 9.2 E3;
// editor-ui §9). Owner: W3 > E3.
//
// The highlighter has no commands, panels or dialogs. It contributes one CodeMirror extension per
// document view through the editor-extension registry (app/src/state/editor-extensions.ts); the
// editor component (E2) applies it. The line analysis is app/src/core/highlight; this folder holds
// the decorations and the preset resolution (colors.ts), including the port's `Auto` preset.

import type { FeatureModule } from '../../contracts';
import { createHighlightEnvironment, highlightExtension } from './extension';

export const feature: FeatureModule = {
  id: 'highlight',
  init(ctx) {
    const env = createHighlightEnvironment(ctx);
    return ctx.editorExtensions.register((doc) => highlightExtension(env, doc));
  },
};
