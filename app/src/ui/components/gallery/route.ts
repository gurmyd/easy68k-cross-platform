// When to show the gallery instead of the application (ARCHITECTURE.md 9.1 W2:
// "a gallery page at ?gallery"). Owner: W2. The entry point (main.tsx, W3)
// calls galleryRequest(location.search) and, when it returns a request, loads
// the gallery with a dynamic import so that it is not part of the app bundle:
//
//   const gallery = galleryRequest(location.search);
//   if (gallery) {
//     const { mountGallery } = await import('./ui/components/gallery/mount');
//     mountGallery(container, gallery);
//   }

import type { ThemeSetting } from '../../../styles/theme';

export interface GalleryRequest {
  /** From ?theme=light|dark|system; default 'system'. */
  theme: ThemeSetting;
}

/** The gallery request in a URL query string, or null when the page is the application. */
export function galleryRequest(search: string): GalleryRequest | null {
  const params = new URLSearchParams(search);
  if (!params.has('gallery')) return null;
  const theme = params.get('theme');
  return { theme: theme === 'light' || theme === 'dark' ? theme : 'system' };
}
