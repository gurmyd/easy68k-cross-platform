// The Output feature in an application made of the wave-zero stubs, and the panel's markup under
// Node (ARCHITECTURE.md 2.5, 2.11). What needs a browser - keys, focus, pixels, full screen - is in
// check-output.mjs; what needs the engine is in engine.test.ts.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PROGRAM_KEYS_SELECTOR } from '../../commands/keymap';
import { outputPanelKeyAction } from '../../commands/output-keys';
import { ApplicationProvider } from '../../state/context';
import { panelVisible } from '../../state/panels';
import { shellStateOf } from '../../state/shell';
import { createInertSimSession } from '../../state/stub-services';
import { createFakePlatform, createTestApplication, type TestApplication } from '../../state/testing';
import { feature } from './index';
import { outputOf } from './model';
import { OutputPanel } from './OutputPanel';

const render = (app: TestApplication) =>
  renderToStaticMarkup(
    <ApplicationProvider app={app}>
      <OutputPanel />
    </ApplicationProvider>,
  );

const withZoom = (app: TestApplication, outputZoom: 'fit' | 1 | 2) =>
  app.ctx.settings.update((settings) => ({
    ...settings,
    app: { ...settings.app, layout: { ...settings.app.layout, outputZoom } },
  }));

describe('the feature module', () => {
  it('contributes the Output panel of Simulator mode and its six commands', () => {
    const app = createTestApplication({ features: [feature] });
    expect(app.panels.find('simulator', 'output')).toMatchObject({ id: 'output', title: 'Output', mode: 'simulator' });
    for (const id of [
      'sim.view.output',
      'sim.output.fullscreen',
      'sim.output.paste',
      'sim.output.releaseKeyboard',
      'sim.options.size',
      'sim.options.textWrap',
    ]) {
      expect(app.commands.hasHandler(id), id).toBe(true);
      expect(app.commands.isEnabled(id), id).toBe(true);
    }
    app.dispose();
  });

  it('starts with the stub session of wave zero: 640x480, no wrap, windowed', () => {
    const app = createTestApplication({ features: [feature] });
    expect(app.ctx.store.getState().sim.output).toEqual({
      width: 640,
      height: 480,
      fullScreen: false,
      textWrap: false,
    });
    expect(app.commands.isChecked('sim.options.size', 0)).toBe(true);
    expect(app.commands.isChecked('sim.options.size', 1)).toBe(false);
    expect(app.commands.isChecked('sim.options.textWrap')).toBe(false);
    expect(outputOf(app.ctx).fullScreen.phase).toBe('windowed');
    app.dispose();
  });

  it("follows the engine's full-screen flag, whoever changed it", () => {
    // An engine whose flag the test sets, as TRAP #15 task 33 and a stop do in the real one.
    let flag = 0;
    let broken = false;
    let phase: 'idle' | 'loading' = 'idle';
    const app = createTestApplication({
      features: [feature],
      services: {
        createSimSession(ctx) {
          const session = createInertSimSession(ctx);
          const engine = {
            ...session.engine,
            getOption() {
              if (broken) throw new Error('This simulator engine was released');
              return flag;
            },
          };
          const controller = Object.defineProperty({ ...session.controller }, 'phase', { get: () => phase });
          return { ...session, engine, controller };
        },
      },
    });
    const output = outputOf(app.ctx);
    flag = 1; // task 33 with D1.L = 2
    output.followEngine();
    expect(output.fullScreen.phase).toBe('waiting'); // no panel, no gesture: the request waits
    expect(app.ctx.store.getState().sim.output.fullScreen).toBe(true);

    // While the engine cannot be asked (a load, a cold start) nothing changes.
    flag = 0;
    phase = 'loading';
    output.followEngine();
    phase = 'idle';
    broken = true;
    output.followEngine();
    expect(output.fullScreen.phase).toBe('waiting');

    broken = false; // the program stopped: the engine cleared its flag
    output.followEngine();
    expect(output.fullScreen.phase).toBe('windowed');
    expect(app.ctx.store.getState().sim.output.fullScreen).toBe(false);
    app.dispose();
  });

  it('a toggle by the user is not undone while the engine has not heard of it yet', () => {
    // The stub session's controller never runs the call and its engine always answers 0.
    const app = createTestApplication({ features: [feature] });
    const output = outputOf(app.ctx);
    output.fullScreen.set(true, 'command');
    output.followEngine();
    expect(output.fullScreen.wanted).toBe(true);
    output.fullScreen.set(false, 'command');
    output.followEngine();
    expect(output.fullScreen.wanted).toBe(false);
    app.dispose();
  });

  it('a cold start leaves full screen', () => {
    const app = createTestApplication({ features: [feature] });
    const output = outputOf(app.ctx);
    output.fullScreen.set(true, 'command');
    output.engineReplaced();
    expect(output.fullScreen.phase).toBe('windowed');
    app.dispose();
  });

  it("a refused request shows the original's box: caption Information, NO icon, one OK button", async () => {
    // simIOu.cpp:290 is `Application->MessageBoxA(text, "Information")`: no flags, so MB_OK
    // without a picture. The (i) of an information box would be the port's invention.
    const app = createTestApplication({ features: [feature] });
    const output = outputOf(app.ctx);
    const boxes = () => app.ctx.store.getState().dialogs.stack;
    const expected = {
      id: 'message',
      modal: true,
      props: {
        title: 'Information',
        text: "Sorry, this computer's configuration does not support the desired screen resolution in full screen mode.",
        icon: 'none',
        buttons: ['OK'],
      },
    };

    // The browser rejects the request although a gesture was present.
    output.attachDriver({
      available: () => true,
      gestureActive: () => true,
      enter: async () => false,
      leave: async () => {},
    });
    output.fullScreen.toggle();
    await Promise.resolve();
    await Promise.resolve();
    expect(boxes()).toHaveLength(1);
    expect(boxes()[0]).toMatchObject(expected);
    expect(output.fullScreen.phase).toBe('windowed');
    app.dialogs.close(boxes()[0]?.key ?? -1, 'OK');

    // The page may not go full screen at all (embedded without permission): the box comes at once.
    output.attachDriver({
      available: () => false,
      gestureActive: () => true,
      enter: async () => true,
      leave: async () => {},
    });
    output.fullScreen.toggle();
    expect(boxes()).toHaveLength(1);
    expect(boxes()[0]).toMatchObject(expected);
    app.dispose();
  });

  it('desktop app: the window leaves full screen by the system itself and the panel follows', async () => {
    // Platform.onFullScreenChange (added at gate I1): the green button of the window, for example.
    let system: ((on: boolean) => void) | null = null;
    let listening = false;
    const windowCalls: boolean[] = [];
    const app = createTestApplication({
      features: [feature],
      platform: createFakePlatform({
        kind: 'desktop',
        setFullScreen: async (on) => {
          windowCalls.push(on);
          return true;
        },
        onFullScreenChange(listener) {
          system = listener;
          listening = true;
          return () => {
            listening = false;
          };
        },
      }),
    });
    const output = outputOf(app.ctx);
    const notify = (on: boolean) => (system as ((on: boolean) => void) | null)?.(on);
    expect(listening).toBe(true); // from the window's start, whether or not the panel is on screen
    output.attachDriver({
      available: () => true,
      gestureActive: () => true,
      enter: () => app.ctx.platform.setFullScreen?.(true) ?? Promise.resolve(false),
      leave: async () => void (await app.ctx.platform.setFullScreen?.(false)),
    });

    // A notice while the panel is windowed means nothing to it (the user's own full-screen window).
    notify(true);
    notify(false);
    expect(output.fullScreen.phase).toBe('windowed');

    output.fullScreen.toggle();
    await Promise.resolve();
    await Promise.resolve();
    expect(output.fullScreen.phase).toBe('full');
    notify(true); // the system confirms what the port asked for
    expect(output.fullScreen.phase).toBe('full');

    notify(false); // the user left with the green button
    expect(output.fullScreen.phase).toBe('windowed');
    expect(app.ctx.store.getState().sim.output.fullScreen).toBe(false);
    expect(windowCalls).toEqual([true]); // the window has left already: it is not asked again

    app.dispose();
    expect(listening).toBe(false);
  });

  it('View > Output Window expands a collapsed panel and asks for the focus', async () => {
    const app = createTestApplication({ features: [feature] });
    shellStateOf(app.ctx).setState((state) => ({ ...state, outputCollapsed: true }));
    expect(panelVisible(app.ctx, 'output')).toBe(false);
    await app.ctx.commands.run('sim.view.output');
    expect(panelVisible(app.ctx, 'output')).toBe(true);
    expect(shellStateOf(app.ctx).getState().focusRequest?.panel).toBe('output');
    app.dispose();
  });

  it('leaving Simulator mode leaves full screen, until the window is disposed', async () => {
    const app = createTestApplication({ features: [feature] });
    const output = outputOf(app.ctx);
    output.attachDriver({
      available: () => true,
      gestureActive: () => true,
      enter: async () => true,
      leave: async () => {},
    });
    const enter = async () => {
      await app.ctx.commands.run('app.mode.set', 'simulator');
      output.fullScreen.set(true, 'gesture');
      await Promise.resolve();
      expect(output.fullScreen.phase).toBe('full');
    };
    await enter();
    await app.ctx.commands.run('app.mode.set', 'editor');
    expect(output.fullScreen.phase).toBe('windowed');

    await enter();
    app.dispose();
    await app.ctx.commands.run('app.mode.set', 'editor');
    expect(output.fullScreen.phase).toBe('full'); // nobody is listening any more
  });
});

describe('the panel', () => {
  it('has the header strip: title, size, zoom choice, full-screen button', () => {
    const app = createTestApplication({ features: [feature] });
    const html = render(app);
    expect(html).toContain('<h2 class="e68-output__title">Output</h2>');
    expect(html).toContain('<span class="e68-output__size">640x480</span>');
    expect(html).toContain('zoom:');
    expect(html).toMatch(
      /<option value="fit" selected="">Fit<\/option><option value="1">100%<\/option><option value="2">200%<\/option>/,
    );
    expect(html).toContain('aria-label="Full Screen (Alt+Enter)"');
    expect(html).toContain('aria-label="Collapse the Output panel"');
    app.dispose();
  });

  it("shows the stored zoom choice and the platform's chords", () => {
    const app = createTestApplication({ features: [feature], platform: createFakePlatform({ os: 'mac' }) });
    withZoom(app, 2);
    const html = render(app);
    expect(html).toContain('<option value="2" selected="">200%</option>');
    expect(html).toContain('aria-label="Full Screen (Option+Return)"');
    expect(html).toContain('Ctrl+Option+O moves to the next panel.');
    app.dispose();
  });

  it('has the hidden textarea that takes the keys for the program', () => {
    const app = createTestApplication({ features: [feature] });
    const html = render(app);
    const textarea = /<textarea[^>]*>/.exec(html)?.[0] ?? '';
    // The marker the keyboard dispatcher steps aside for, and the place the shell puts the focus.
    expect(PROGRAM_KEYS_SELECTOR).toBe('[data-e68-keys="program"]');
    expect(textarea).toContain('data-e68-keys="program"');
    expect(textarea).toContain('data-e68-panel-focus=""');
    expect(textarea).toContain('aria-label="Keyboard of the running program. Ctrl+Alt+O moves to the next panel."');
    expect(textarea).toContain('spellCheck="false"');
    app.dispose();
  });

  it('has the canvas as an image with a label, and the text mirror as a polite live region', () => {
    const app = createTestApplication({ features: [feature] });
    const html = render(app);
    expect(html).toMatch(/<canvas class="e68-output__canvas" role="img" aria-label="[^"]+"/);
    // The backing size is not an attribute: the presenter sets it to the surface size (2.5).
    expect(/<canvas[^>]*>/.exec(html)?.[0]).not.toMatch(/ (width|height)="/);
    expect(html).toContain('style="width:640px;height:480px;margin-left:0;margin-top:0"');
    expect(html).toContain('<div class="e68-sr" role="log" aria-label="Text of the Output panel">');
    app.dispose();
  });

  it('shows the prompt while a full-screen request waits for a gesture', () => {
    const app = createTestApplication({ features: [feature] });
    expect(render(app)).not.toContain('Press any key or click to enter full screen');
    outputOf(app.ctx).fullScreen.set(true, 'program');
    const html = render(app);
    expect(html).toContain('>Press any key or click to enter full screen</button>');
    expect(html).not.toContain('data-fullscreen');
    app.dispose();
  });
});

describe('the three chords of the panel', () => {
  // The panel asks commands/output-keys.ts (W3); these are the answers it relies on.
  const env = { desktop: false, keyCommandsEnabled: true, commands: { isEnabled: () => true } };
  const event = (key: string, code: string, modifiers: object = {}) => ({
    key,
    code,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...modifiers,
  });

  it('Windows and Linux: Alt+Enter, Shift+Insert (also from the keypad with NumLock off), Ctrl+Alt+O', () => {
    const windows = { ...env, os: 'windows' as const };
    expect(outputPanelKeyAction(event('Enter', 'Enter', { altKey: true }), windows)).toEqual({
      kind: 'program',
      then: 'fullscreen',
    });
    expect(outputPanelKeyAction(event('Insert', 'Insert', { shiftKey: true }), windows)).toEqual({
      kind: 'program',
      then: 'paste',
    });
    expect(outputPanelKeyAction(event('Insert', 'Numpad0', { shiftKey: true }), windows)).toEqual({
      kind: 'program',
      then: 'paste',
    });
    expect(outputPanelKeyAction(event('o', 'KeyO', { ctrlKey: true, altKey: true }), windows)).toEqual({
      kind: 'release',
    });
    // Ctrl+Tab moves on in the desktop app only.
    expect(outputPanelKeyAction(event('Tab', 'Tab', { ctrlKey: true }), windows)).toEqual({
      kind: 'program',
      then: null,
    });
    expect(outputPanelKeyAction(event('Tab', 'Tab', { ctrlKey: true }), { ...windows, desktop: true })).toEqual({
      kind: 'program',
      then: 'nextPanel',
    });
  });

  it("further modifiers: Alt+Enter and Ctrl+Tab still act, as the original's Shift.Contains; paste is exact", () => {
    // simIOu.cpp:434-439 tests "Ctrl is held", "Alt is held", "Shift is held", first match wins.
    const windows = { ...env, os: 'windows' as const };
    const desktop = { ...windows, desktop: true };
    const fullscreen = { kind: 'program', then: 'fullscreen' };
    const nothing = { kind: 'program', then: null };
    expect(outputPanelKeyAction(event('Enter', 'Enter', { altKey: true, shiftKey: true }), windows)).toEqual(
      fullscreen,
    );
    expect(outputPanelKeyAction(event('Enter', 'Enter', { altKey: true, ctrlKey: true }), windows)).toEqual(fullscreen);
    expect(outputPanelKeyAction(event('Enter', 'NumpadEnter', { altKey: true }), windows)).toEqual(fullscreen);
    expect(outputPanelKeyAction(event('Tab', 'Tab', { ctrlKey: true, shiftKey: true }), desktop)).toEqual({
      kind: 'program',
      then: 'nextPanel',
    });
    expect(outputPanelKeyAction(event('Tab', 'Tab', { ctrlKey: true, shiftKey: true }), windows)).toEqual(nothing);
    // A browser fires `paste` for its own chord only, so the paste chord cannot follow that rule.
    expect(outputPanelKeyAction(event('Insert', 'Insert', { shiftKey: true, ctrlKey: true }), windows)).toEqual(
      nothing,
    );
    expect(outputPanelKeyAction(event('Insert', 'Insert', { shiftKey: true, altKey: true }), windows)).toEqual(nothing);
    // After task 24 none of them acts.
    const off = { ...desktop, keyCommandsEnabled: false };
    expect(outputPanelKeyAction(event('Enter', 'Enter', { altKey: true, shiftKey: true }), off)).toEqual(nothing);
    expect(outputPanelKeyAction(event('Tab', 'Tab', { ctrlKey: true, shiftKey: true }), off)).toEqual(nothing);
  });

  it('macOS: Option+Return, Cmd+V, Ctrl+Option+O', () => {
    const mac = { ...env, os: 'mac' as const };
    expect(outputPanelKeyAction(event('Enter', 'Enter', { altKey: true }), mac)).toEqual({
      kind: 'program',
      then: 'fullscreen',
    });
    expect(outputPanelKeyAction(event('v', 'KeyV', { metaKey: true }), mac)).toEqual({
      kind: 'program',
      then: 'paste',
    });
    expect(outputPanelKeyAction(event('ø', 'KeyO', { ctrlKey: true, altKey: true }), mac)).toEqual({ kind: 'release' });
  });
});
