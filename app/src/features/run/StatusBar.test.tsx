// The simulator's status bar as markup: the run-state cell is a polite live region, so that a halt
// is announced (ARCHITECTURE.md 2.11; finding Q1-5 of docs/integration/rc.md).
//
// Owner: SH8.

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { ApplicationProvider } from '../../state/context';
import { createTestApplication, type TestApplication } from '../../state/testing';
import { feature } from './index';
import { SimStatusBar } from './StatusBar';

const apps: TestApplication[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.dispose();
});

function render(): string {
  const app = createTestApplication({ features: [feature] });
  apps.push(app);
  return renderToStaticMarkup(
    <ApplicationProvider app={app}>
      <SimStatusBar />
    </ApplicationProvider>,
  );
}

describe('SimStatusBar', () => {
  it('the run-state cell, and only it, is a status region (polite), so a halt is announced', () => {
    const html = render();
    expect(html).toMatch(/<span class="e68-statusbar__cell" data-e68-status="run" role="status">[^<]+<\/span>/);
    // The other cells change on every step (PC) or only by the user's own action: not announced.
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).not.toContain('aria-live="assertive"');
  });
});
