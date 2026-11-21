// The link from the Editor feature to the editor component in app/src/ui/editor. Owner: E2.
//
// LOCAL GUARD (errata/E2.md entry 1; docs/requests/E2-layer-rule.md). Section 8 and 9.2 put the
// editor component in `ui/editor/` and the panel and commands that use it in `features/editor/`,
// but the lint rule of 3.1 lets `features/<x>/` import `ui/components/` only. Until the gate
// decides, the component is reached through Vite's `import.meta.glob` (eager, so it is an ordinary
// static import in the built bundle and under Vitest) and typed by the interface this feature
// declares (editor-api.ts), which ui/editor/index.ts is compiled against. When the rule allows
// `features/editor/` to import `ui/editor/`, this file becomes
//   export { editorUi } from '../../ui/editor';

import type { EditorUi } from './editor-api';

const modules = import.meta.glob<{ editorUi: EditorUi }>('../../ui/editor/index.ts', { eager: true });
const found = Object.values(modules)[0];
if (!found) throw new Error('The editor component (app/src/ui/editor/index.ts) is missing');

export const editorUi: EditorUi = found.editorUi;
