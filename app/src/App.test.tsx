// Placeholder unit test written by W0, so that `npm test` has something to
// run from the first day. It belongs to the owner of App.tsx (W3).

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App placeholder', () => {
  it('renders the product name and subtitle', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('<h1>EASy68K</h1>');
    expect(html).toContain('unofficial web and macOS port');
  });
});
