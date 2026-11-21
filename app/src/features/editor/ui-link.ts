// The link from the Editor feature to the editor component in app/src/ui/editor. Owner: E2.
//
// Section 8 and 9.2 put the editor component in `ui/editor/` and the panel and commands that use it
// in `features/editor/`. The layer rule lets `features/editor/` (and no other feature) import
// `ui/editor/` (gate I1, docs/requests/E2-layer-rule.md; errata/E2.md entry 1). The component is
// typed by the interface this feature declares (editor-api.ts), which ui/editor/index.ts satisfies.

export { editorUi } from '../../ui/editor';
