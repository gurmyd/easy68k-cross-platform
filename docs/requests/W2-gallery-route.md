# Request from W2: route `?gallery` to the component gallery (for W3, `app/src/main.tsx`)

Status: done (W3 added the route to `app/src/main.tsx`; docs/porting/errata/W3.md).

ARCHITECTURE.md 9.1 gives W2 "a gallery page at `?gallery`". The entry point that would show it,
`app/src/main.tsx`, belongs to W3 (W0 erratum 4), so W2 cannot add the route itself
(docs/porting/errata/W2.md, entry 4).

W2 delivers the two pieces; please add the route when `main.tsx` is rewritten:

```tsx
import { galleryRequest } from './ui/components/gallery/route';

const gallery = galleryRequest(location.search);
if (gallery) {
  // Dynamic import: the gallery is not part of the application bundle.
  const { mountGallery } = await import('./ui/components/gallery/mount');
  mountGallery(container, gallery);
} else {
  // ... the application, as now
}
```

- `galleryRequest(search)` returns `null` for the application, or `{ theme }` for `?gallery`
  (optional `&theme=light|dark|system`).
- `mountGallery(container, request)` imports `app/src/styles` itself and renders the gallery in
  `StrictMode`; it sets `document.title`.
- Nothing else is needed: no settings, store or services.

Until then the gallery is available on the dev server at
`/src/ui/components/gallery/gallery.html` (`npm run dev`).
