// Browser-check support for check-sim-main.mjs: renders an application component into a container.
// The check script builds the application itself (state/testing.ts createTestApplication with this
// feature and the session double of testing.ts over the real engine) and passes the root component
// (app/src/App.tsx) in, because a feature may not import it. This module only supplies React's
// renderer, which the script cannot import by its bare name inside the page.
//
// Never imported by the application.

import { createElement, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';

/** Renders `<App app={app} />` into `container`; returns the function that unmounts it. */
export function mountApp<A>(container: HTMLElement, App: ComponentType<{ app: A }>, app: A): () => void {
  const root = createRoot(container);
  root.render(createElement(App, { app }));
  return () => root.unmount();
}
