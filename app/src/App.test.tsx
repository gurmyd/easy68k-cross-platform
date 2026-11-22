// The application starts with the stub services of 3.12.3 and shows three modes (W3 acceptance,
// ARCHITECTURE.md 9.1). Rendered to markup under Node; the same start in real browsers is checked
// by app/src/ui/shell/check-shell.mjs.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { EXIT_TEXT } from './state/shell';
import { DockEngine } from './ui/dock/engine';
import { createFakePlatform, createTestApplication } from './state/testing';

const render = (app = createTestApplication()) => renderToStaticMarkup(<App app={app} />);

describe('App', () => {
  it('renders the window of 2.1: menu bar, mode switch, toolbar, workspaces, status bar', () => {
    const html = render();
    expect(html).toContain('role="menubar"');
    expect(html).toContain('role="radiogroup" aria-label="Mode"');
    expect(html).toContain('role="toolbar" aria-label="Editor toolbar"');
    expect(html).toContain('class="e68-statusbar"');
    for (const mode of ['Editor', 'Simulator', 'EASyBIN']) expect(html).toContain(`>${mode}</button>`);
  });

  it('keeps the three workspaces mounted and shows the one of the current mode', async () => {
    const app = createTestApplication();
    const workspaces = (html: string) =>
      [...html.matchAll(/data-e68-workspace="(\w+)"( hidden="")?/g)].map(
        (match) => `${match[1]}${match[2] ? ':hidden' : ''}`,
      );
    expect(workspaces(render(app))).toEqual(['editor', 'simulator:hidden', 'easybin:hidden']);

    await app.ctx.commands.run('app.mode.set', 'simulator');
    const html = render(app);
    expect(workspaces(html)).toEqual(['editor:hidden', 'simulator', 'easybin:hidden']);
    expect(html).toContain('role="toolbar" aria-label="Simulator toolbar"');
    expect(html).toContain('aria-label="Simulator menu"');

    await app.ctx.commands.run('app.mode.next');
    expect(workspaces(render(app))).toEqual(['editor:hidden', 'simulator:hidden', 'easybin']);
    await app.ctx.commands.run('app.mode.next');
    expect(app.ctx.store.getState().mode).toBe('editor');
  });

  it('shows the menus of the mode in the original order', async () => {
    const titles = (html: string) => {
      const bar = /<div role="menubar".*?<\/div>/s.exec(html)?.[0] ?? '';
      return [...bar.matchAll(/<button[^>]*role="menuitem"[^>]*>(.*?)<\/button>/g)].map((match) =>
        (match[1] ?? '').replace(/<[^>]+>/g, ''),
      );
    };
    const app = createTestApplication();
    expect(titles(render(app))).toEqual(['File', 'Edit', 'Project', 'Options', 'Window', 'Help']);
    await app.ctx.commands.run('app.mode.set', 'simulator');
    expect(titles(render(app))).toEqual(['File', 'Search', 'Run', 'View', 'Options', 'Help']);
    await app.ctx.commands.run('app.mode.set', 'easybin');
    expect(titles(render(app))).toEqual(['File', 'Help']);
  });

  it('draws the docks of Editor and Simulator mode and the region of EASyBIN', () => {
    // The regions of 2.2 and 2.3 are the docks' panels (ARCHITECTURE-PLUS P3.1, N1). FlexLayout lays
    // them out, and mounts them, only in a page: under Node the docks render their frame, and the
    // regions on screen are checked by app/src/ui/dock/check-dock.mjs.
    const html = render();
    const docks = [...html.matchAll(/data-e68-dock="(\w+)"/g)].map((match) => match[1]);
    expect(docks).toEqual(['editor', 'simulator']);
    expect(html).toMatch(
      /data-e68-workspace="editor"><div class="e68-dock" data-e68-dock="editor"><div class="flexlayout__layout">/,
    );
    const regions = [...html.matchAll(/data-e68-panel="([\w-]+)"/g)].map((match) => match[1]);
    expect(regions).toEqual(['easybin']);
  });

  it('has no in-window menu bar in the macOS app, where the menu is the native one', () => {
    const mac = createTestApplication({ platform: createFakePlatform({ kind: 'desktop', os: 'mac' }) });
    expect(render(mac)).not.toContain('role="menubar"');
    const windows = createTestApplication({ platform: createFakePlatform({ kind: 'desktop', os: 'windows' }) });
    expect(render(windows)).toContain('role="menubar"');
  });

  it('hides the Files panel by default in the desktop app and shows it in a browser', () => {
    const filesIn = (app: ReturnType<typeof createTestApplication>) =>
      new DockEngine(app.ctx, app.panels, app.shell, 'editor').has('files');
    expect(filesIn(createTestApplication())).toBe(true);
    expect(filesIn(createTestApplication({ platform: createFakePlatform({ kind: 'desktop', os: 'mac' }) }))).toBe(
      false,
    );
  });

  it('shows every toolbar command without a handler as disabled', () => {
    const html = render();
    const buttons = [...html.matchAll(/<button[^>]*data-command="([\w.]+)"[^>]*>/g)].map((match) => ({
      id: match[1],
      disabled: /\sdisabled=""/.test(match[0]),
    }));
    expect(buttons.map((button) => button.id)).toContain('ed.project.assemble');
    for (const button of buttons) {
      // The theme button is the shell's own and has a handler.
      expect(button.disabled, button.id).toBe(button.id !== 'app.theme.set');
    }
  });

  it('shows `You can close this tab.` after Exit in a browser', () => {
    const app = createTestApplication();
    app.shell.setState((state) => ({ ...state, exited: true }));
    const html = render(app);
    expect(html).toContain(EXIT_TEXT);
    expect(html).not.toContain('role="toolbar"');
  });
});
