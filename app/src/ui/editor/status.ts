// The texts of a document's status bar (editor-ui §7.2; ARCHITECTURE.md 2.2, 1.4 note 17). Owner: E2.
//
//   panel 0   `<line>: <column>`, both 1-based; the column is the TRUE visual column (tabs expanded
//             with the document's stops), not the original's count-the-tabs value (§19.3)
//   panel 1   `Modified` or empty
//   panel 2   `Insert` or `Replace`; a click toggles (1.3.2)
//   panel 3   the port's information: encoding, line ends and tab mode (note 17), for example
//             `Windows-1252  CR LF  Fixed tabs 4`. The original's 64-underscore ruler is dropped.

import type { EditorState } from '@codemirror/state';
import { tabModeText, visualColumn, type TabSettings } from './tab-model';

export interface StatusTexts {
  position: string;
  modified: string;
  insert: string;
  info: string;
}

/**
 * `<line>: <column>` of the caret. With a selection this is the END of the selection (editor-ui
 * §7.2), whichever way it was made: the original reads `CaretPos`, which VCL takes from
 * `EM_EXGETSEL`'s `cpMax`. The Tab key works from the same position (`range.to`, editing.ts).
 */
export function positionText(state: EditorState, settings: TabSettings): string {
  const end = state.selection.main.to;
  const line = state.doc.lineAt(end);
  return `${line.number}: ${visualColumn(line.text, end - line.from, settings) + 1}`;
}

export function statusTexts(
  state: EditorState,
  input: TabSettings & { modified: boolean; insertMode: boolean },
): StatusTexts {
  return {
    position: positionText(state, input),
    modified: input.modified ? 'Modified' : '',
    insert: input.insertMode ? 'Insert' : 'Replace',
    info: `Windows-1252  CR LF  ${tabModeText(input)}`,
  };
}
