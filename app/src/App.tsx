// The root component (ARCHITECTURE.md 2.1). Owner: W3.
//
// `app` is the Application that bootstrap() built for this window: services, commands, and the
// panels and dialogs of the features. The component tree below it is the shell (ui/shell), which
// draws the window frame of section 2.1 and mounts the features' panels in its regions.

import type { Application } from './state/context';
import { ApplicationProvider } from './state/context';
import { Shell } from './ui/shell';

export function App({ app }: { app: Application }) {
  return (
    <ApplicationProvider app={app}>
      <Shell />
    </ApplicationProvider>
  );
}
