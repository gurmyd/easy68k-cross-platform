// The simulator's status bar as markup: a hidden polite region announces the settled run states
// (ARCHITECTURE.md 2.11; finding Q1-5 of docs/integration/rc.md; announce.ts, errata SH8.md entry
// 43); the visible run-state cell is not a live region.
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
  it('one hidden polite status region announces; the visible cells, the run state among them, do not', () => {
    const html = render();
    expect(html).toMatch(/<span class="e68-statusbar__cell" data-e68-status="run">[^<]+<\/span>/);
    expect(html).toContain('<span class="e68-sr" role="status" data-e68-run-announce=""></span>');
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html).not.toContain('aria-live');
  });
});
