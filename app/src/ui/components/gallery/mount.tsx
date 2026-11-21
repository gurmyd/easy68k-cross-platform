// Mounts the gallery into a page element. Owner: W2. Used by the application's
// entry point for ?gallery (route.ts) and by gallery.html on the dev server.

import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import '../../../styles/index';
import { Gallery } from './Gallery';
import type { GalleryRequest } from './route';

export function mountGallery(container: Element, request: GalleryRequest): Root {
  document.title = 'Component kit - easy68k-cross-platform';
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <Gallery initialTheme={request.theme} />
    </StrictMode>,
  );
  return root;
}
