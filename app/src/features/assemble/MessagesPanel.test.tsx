// The Messages panel of Editor mode as markup (server rendering under Node, no DOM): the grid is
// the one element named `Assembler messages`; the hidden polite log region beside it has no name
// of its own, so that a screen reader's list of regions does not show the same name twice.

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { ApplicationProvider } from '../../state/context';
import { createTestApplication, type TestApplication } from '../../state/testing';
import { feature } from './index';
import { MessagesPanel } from './MessagesPanel';
import { MESSAGES_LABEL } from './texts';

const apps: TestApplication[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.dispose();
});

function markup(): string {
  const app = createTestApplication({ features: [feature] });
  apps.push(app);
  return renderToStaticMarkup(
    <ApplicationProvider app={app}>
      <MessagesPanel />
    </ApplicationProvider>,
  );
}

describe('MessagesPanel markup', () => {
  it('names the grid once and leaves the polite log region without a name', () => {
    const html = markup();
    const names = [...html.matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1]);
    expect(names.filter((name) => name === MESSAGES_LABEL)).toHaveLength(1);
    const log = html.match(/<div[^>]*role="log"[^>]*>/);
    expect(log?.[0]).toContain('aria-live="polite"');
    expect(log?.[0]).not.toContain('aria-label');
    expect(log?.[0]).not.toContain('aria-labelledby');
  });
});
