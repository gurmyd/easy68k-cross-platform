// The content of one viewer tab (ARCHITECTURE-PLUS P3.4.2). Owner: N6.
//
// The strip: the file's name, its size, `Actual Size` (pictures: a toggle with aria-pressed;
// pressed = 1:1 with scroll bars, not pressed = scaled to fit), `Open as Text`, `Export` (web
// only; both left out of the strip while the notice shows them). Below it:
//   - a picture: <img src="blob:..."> with alt = the file's name, centred on --c-surface; one that
//     fails to decode shows the notice;
//   - a PDF: an iframe whose src is the viewer's own `blob:` URL of type application/pdf, titled
//     `PDF: <name>`, without a sandbox attribute (a sandboxed frame blocks the browser's own PDF
//     viewer), with the line under the strip; where navigator.pdfViewerEnabled is false, the PDF
//     notice with Export instead of the frame;
//   - any other file: the notice with `Open as Text` and `Export`.
// The dock puts this into the element that carries data-e68-panel="viewer:<n>" and role tabpanel;
// the scrolling body takes the focus (data-e68-panel-focus).

import { useState, useSyncExternalStore } from 'react';
import { Button } from '../../ui/components';
import type { ViewerHandle, ViewerSnapshot } from './model';
import {
  ACTUAL_SIZE,
  EXPORT,
  noticeText,
  OPEN_AS_TEXT,
  PDF_HINT_DESKTOP,
  PDF_HINT_WEB,
  pdfFrameTitle,
  pdfNoticeText,
  sizeText,
} from './texts';
import './viewer.css';

/** The notice of P3.4.2, with its buttons `Open as Text` and `Export` (web only). */
function Notice({ text, handle }: { text: string; handle: ViewerHandle }) {
  const { actions } = handle;
  return (
    <div className="e68-viewer__notice">
      <p className="e68-viewer__notice-text">{text}</p>
      <div className="e68-viewer__notice-buttons">
        <Button caption={OPEN_AS_TEXT} onClick={() => void actions.openAsText()} />
        {actions.exportFile && <Button caption={EXPORT} onClick={actions.exportFile} />}
      </div>
    </div>
  );
}

/** A picture; `key`ed by its URL so that a new file starts unscaled-state and unfailed. */
function Picture({ snapshot, actual, onFailed }: { snapshot: ViewerSnapshot; actual: boolean; onFailed(): void }) {
  return (
    <img
      className="e68-viewer__picture"
      data-actual={actual ? 'true' : 'false'}
      src={snapshot.url ?? undefined}
      alt={snapshot.name}
      draggable={false}
      onError={onFailed}
    />
  );
}

export function ViewerPanel({ handle }: { handle: ViewerHandle }) {
  const snapshot = useSyncExternalStore(handle.subscribe, handle.snapshot, handle.snapshot);
  const { actions } = handle;
  const [actual, setActual] = useState(false);
  // The URL whose picture failed to decode; a new file (another URL) tries again.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  const pictureFailed = snapshot.kind === 'picture' && failedUrl !== null && failedUrl === snapshot.url;
  const showsPicture = snapshot.kind === 'picture' && !pictureFailed;
  const showsFrame = snapshot.kind === 'pdf' && actions.pdfViewerEnabled();
  // The notice carries `Open as Text` and `Export` itself; the strip does not repeat them then, so
  // that the tab holds one button of each name (errata N6 7).
  const showsNotice = !showsPicture && !showsFrame;

  let body;
  if (showsPicture) {
    body = (
      <Picture
        key={snapshot.url ?? ''}
        snapshot={snapshot}
        actual={actual}
        onFailed={() => setFailedUrl(snapshot.url)}
      />
    );
  } else if (showsFrame) {
    // No sandbox attribute (P3.4.2): its src is only ever this viewer's own blob of type
    // application/pdf; the page's policy (inherited by a blob: document) lets no script run in it.
    body = (
      <iframe
        key={snapshot.url ?? ''}
        className="e68-viewer__frame"
        src={snapshot.url ?? undefined}
        title={pdfFrameTitle(snapshot.name)}
      />
    );
  } else if (snapshot.kind === 'pdf') {
    body = <Notice text={pdfNoticeText(snapshot.name)} handle={handle} />;
  } else {
    body = <Notice text={noticeText(snapshot.name)} handle={handle} />;
  }

  return (
    <div className="e68-viewer" data-kind={snapshot.kind}>
      <div className="e68-viewer__strip">
        <span className="e68-viewer__name">{snapshot.name}</span>
        <span className="e68-viewer__size">{sizeText(snapshot.bytes.length)}</span>
        <span className="e68-viewer__spacer" />
        {showsPicture && (
          <Button size="small" caption={ACTUAL_SIZE} aria-pressed={actual} onClick={() => setActual((on) => !on)} />
        )}
        {!showsNotice && <Button size="small" caption={OPEN_AS_TEXT} onClick={() => void actions.openAsText()} />}
        {!showsNotice && actions.exportFile && <Button size="small" caption={EXPORT} onClick={actions.exportFile} />}
      </div>
      {showsFrame && <p className="e68-viewer__hint">{actions.desktop ? PDF_HINT_DESKTOP : PDF_HINT_WEB}</p>}
      <div
        className="e68-viewer__body"
        data-actual={showsPicture && actual ? 'true' : 'false'}
        role="group"
        aria-label={snapshot.name}
        tabIndex={0}
        data-e68-panel-focus=""
      >
        {body}
      </div>
    </div>
  );
}
