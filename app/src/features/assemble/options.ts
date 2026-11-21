// The inputs of one assembly besides the files: the options, the names of the outputs and the
// folder a never-saved document lives in (ARCHITECTURE.md 3.8.2, 4.9 step 3, 5.3).
//
// Owner: E5. No DOM: runs under Node.

import type { AsmOptions, DocumentState, EditorSettings, Platform, VPath } from '../../contracts';
import { changeFileExt, childPath, isVPath } from '../../core/paths/winpath';

/**
 * 4.9 step 3 (editor-ui §10.2 step 3, §10.3): the eight flags from the Assembler Options, the tab
 * type and size of the document being assembled (the listing expands tabs with them).
 */
export function asmOptionsFor(editor: EditorSettings, doc: Pick<DocumentState, 'tabType' | 'tabSize'>): AsmOptions {
  return {
    generateListing: editor.generateList,
    generateSRecord: editor.generateSRecord,
    constantsExpanded: editor.constantsExpanded,
    bitFieldInstructions: editor.assembleBitField,
    crossReference: editor.crossReference,
    macrosExpanded: editor.macrosExpanded,
    structuredExpanded: editor.structuredExpanded,
    showWarnings: editor.showWarnings,
    tabType: doc.tabType,
    tabSize: doc.tabSize,
  };
}

/**
 * The folder of a never-saved document (3.8.2): `/browser/Untitled` on the web,
 * `<userData>/Untitled` in the desktop app.
 */
export function untitledFolder(platform: Pick<Platform, 'kind' | 'userDataDir'>): VPath {
  const userData = platform.kind === 'desktop' ? platform.userDataDir : null;
  return userData && isVPath(userData) ? childPath(userData, 'Untitled') : '/browser/Untitled';
}

/** The file an assembly reads as its main source: the document's path, or `<Untitled>/<name>`. */
export function sourcePathOf(doc: Pick<DocumentState, 'path' | 'name'>, untitled: VPath): VPath {
  return doc.path ?? childPath(untitled, doc.name);
}

/**
 * The outputs of a source (5.3, editor-ui §10.3): `ChangeFileExt(<source>, ".L68")` and `".S68"`,
 * in the source's folder. A name without an extension gets one appended.
 */
export function outputPaths(source: VPath): { listing: VPath; sRecord: VPath } {
  return { listing: changeFileExt(source, '.L68'), sRecord: changeFileExt(source, '.S68') };
}
