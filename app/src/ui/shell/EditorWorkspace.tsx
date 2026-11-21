// The workspace frame of Editor mode (ARCHITECTURE.md 2.2). Owner: W3.
//
//   +---------+--------------------------------------------+
//   | files   | editor   (tab strip, editor, status bar)   |
//   |         +============================================+
//   |         | messages (the assembler's message list)    |
//   +---------+--------------------------------------------+
//
// Regions: `files` (left, collapsible; shown by default in a browser, hidden in the desktop app),
// `editor` (the editor area, owner E2) and `messages` (owner E5). The height of the message list
// follows the original (editor-ui §7.3): 5 px before the first assembly, at least 87 px while it
// holds messages, 7 px after a clean assembly or `Clear Error Messages`; the separator above it
// can be dragged at any time.

import { useRef, useState } from 'react';
import { useAppContext, useAppState } from '../../state/context';
import { MESSAGES_INITIAL, MESSAGES_OPEN_MIN, isPanelVisible, messagesPaneHeight } from '../../state/layout';
import { shallowEqual } from '../../state/store';
import { Splitter } from '../components';
import { PanelRegion } from './PanelRegion';
import { useElementSize, useSplit } from './SplitPane';

/** Space the editor keeps above the message list, whatever the user drags. */
const EDITOR_MIN_HEIGHT = 80;

function EditorCenter() {
  const container = useRef<HTMLDivElement>(null);
  const { height: available } = useElementSize(container);
  // `list` changes whenever the message list of the active document is replaced or cleared.
  const { count, assembled, list } = useAppState((state) => {
    const id = state.documents.activeId;
    const summary = id === null ? undefined : state.assemble[id];
    const messages = id === null ? undefined : state.messages[id];
    return {
      count: messages?.length ?? 0,
      assembled: summary !== undefined,
      list: `${id ?? ''}/${summary?.at ?? ''}/${messages?.length ?? 0}`,
    };
  }, shallowEqual);
  // What the user dragged applies until the list changes; then the original's rule decides again.
  const [drag, setDrag] = useState<{ list: string; height: number } | null>(null);
  const dragged = drag !== null && drag.list === list ? drag.height : null;

  const max = Math.max(MESSAGES_OPEN_MIN, available - EDITOR_MIN_HEIGHT);
  const height = Math.min(messagesPaneHeight({ messageCount: count, assembled, dragged }), max);

  return (
    <div ref={container} className="e68-editorws__center">
      <PanelRegion id="editor" mode="editor" className="e68-region--grow" />
      <Splitter
        orientation="horizontal"
        invert
        value={height}
        min={MESSAGES_INITIAL}
        max={max}
        defaultValue={messagesPaneHeight({ messageCount: count, assembled, dragged: null })}
        label="Resize the Messages panel"
        onChange={(value) => setDrag({ list, height: value })}
      />
      <PanelRegion id="messages" mode="editor" className="e68-region--fixed" style={{ height }} />
    </div>
  );
}

export function EditorWorkspace() {
  const ctx = useAppContext();
  const container = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(container);
  const split = useSplit('editor.files', width);
  const filesVisible = useAppState((state) => isPanelVisible(state.settings, 'files', ctx.platform.kind));
  // The children are keyed so that showing or hiding the Files panel never remounts the editor.
  return (
    <div ref={container} className="e68-editorws">
      {filesVisible && (
        <PanelRegion
          key="files"
          id="files"
          mode="editor"
          className="e68-region--fixed"
          style={{ flexBasis: split.basis }}
        />
      )}
      {filesVisible && (
        <Splitter key="files-bar" orientation="vertical" label="Resize the Files panel" {...split.bar} />
      )}
      <EditorCenter key="center" />
    </div>
  );
}
