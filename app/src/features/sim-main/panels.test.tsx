// The panels as markup (server rendering under Node, no DOM) and the register fields' key rules
// wired to the engine: every keystroke of a field is forwarded with editBox and the twenty texts
// are re-read (3.11.3); the SR field types a 0 for Backspace and for an invalid key (sim-ui §4.4).

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { Box, Reg } from '../../contracts';
import { assembleProgram, createTestEngine, type TestEngine } from '../../engine/testing';
import { ApplicationProvider } from '../../state/context';
import { createTestApplication, type TestApplication } from '../../state/testing';
import { applyMaskedEdit, REGISTER_FIELD, SR_FIELD, type MaskedEdit, type MaskedState } from '../../ui/components';
import { beepWave } from './beep';
import { FindDialog } from './FindDialog';
import { feature } from './index';
import { LISTING_HEADING, ListingPanel } from './ListingPanel';
import { MessagesPanel } from './MessagesPanel';
import { simMainOf } from './model';
import { RegistersPanel, SR_FLAGS_CAPTION } from './RegistersPanel';
import { createSessionDouble, type SessionDouble } from './testing';

const repo = (file: string) => fileURLToPath(new URL(`../../../../${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(repo(`engine/dist/${file}`)),
);
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

const apps: TestApplication[] = [];
const engines: TestEngine[] = [];
afterEach(() => {
  for (const app of apps.splice(0)) app.dispose();
  for (const engine of engines.splice(0)) engine.release();
});

function inertApp(): TestApplication {
  const app = createTestApplication({ features: [feature] });
  apps.push(app);
  return app;
}

const render = (app: TestApplication, element: React.ReactElement) =>
  renderToStaticMarkup(<ApplicationProvider app={app}>{element}</ApplicationProvider>);

describe('markup', () => {
  it('Registers: twenty labelled fields in the original tab order, the flag caption verbatim', () => {
    const html = render(inertApp(), <RegistersPanel />);
    const labels = [...html.matchAll(/<label class="e68-regs__label"[^>]*>([^<]+)<\/label>/g)].map((m) => m[1]);
    // Tab order of SIM68Ku.dfm: D0-D7, A0-A7, SR, PC, SS, (Clear Cycles), US.
    expect(labels).toEqual([
      'D0=',
      'D1=',
      'D2=',
      'D3=',
      'D4=',
      'D5=',
      'D6=',
      'D7=',
      'A0=',
      'A1=',
      'A2=',
      'A3=',
      'A4=',
      'A5=',
      'A6=',
      'A7=',
      'SR=',
      'PC=',
      'SS=',
      'US=',
    ]);
    expect(SR_FLAGS_CAPTION).toBe('T S  INT   XNZVC');
    expect(html).toContain(`>${SR_FLAGS_CAPTION}<`);
    expect(html.indexOf('Clear Cycles')).toBeGreaterThan(html.indexOf('SS='));
    expect(html.indexOf('Clear Cycles')).toBeLessThan(html.indexOf('US='));
    // The start-up values of the inert session.
    expect(html).toContain('value="0010000000000000"');
    expect(html).toContain('value="01000000"');
    expect(html).toContain('>Cycles<');
    expect(html).toMatch(/data-cycles="">0</);
  });

  it('Listing: the constant heading, a listbox for the rows', () => {
    const html = render(inertApp(), <ListingPanel />);
    expect(LISTING_HEADING).toBe(' Address  --------Code---------   Line -----------Source----------->>');
    expect(html).toContain(LISTING_HEADING.replace(/>/g, '&gt;'));
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-label="Listing"');
    expect(html).toContain('data-e68-panel-focus');
  });

  it('Messages: a list of the message lines and a polite log region', () => {
    const html = render(inertApp(), <MessagesPanel />);
    expect(html).toContain('aria-label="Messages"');
    expect(html).toContain('role="log"');
    expect(html).toContain('aria-live="polite"');
    // Hidden with the kit's screen-reader class, not a copy of it (gate I1, the kit's request).
    expect(html).toMatch(/class="e68-sr e68-messages__announce" role="log"/);
  });

  it('Find dialog: caption, label and buttons of findDialogS.dfm; the Find button disabled while empty', () => {
    const app = inertApp();
    const html = render(app, <FindDialog props={{}} close={() => {}} />);
    expect(html).toContain('Find');
    expect(html).toMatch(/Fi.*n.*d what:/); // the access key is drawn underlined
    expect(html).toMatch(/Find {2}\(F3\)/);
    expect(html).toContain('Cancel');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Find {2}\(F3\)/);
  });
});

describe('beep', () => {
  it('is a valid 8-bit mono WAV file', () => {
    const wave = beepWave();
    const text = (from: number, to: number) => String.fromCharCode(...wave.subarray(from, to));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 16)).toBe('WAVEfmt ');
    expect(text(36, 40)).toBe('data');
    const view = new DataView(wave.buffer);
    expect(view.getUint32(4, true)).toBe(wave.length - 8);
    expect(view.getUint32(40, true)).toBe(wave.length - 44);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(8);
  });

  it('a refused key plays it through the audio backend', () => {
    const played: number[] = [];
    let loads = 0;
    const app = createTestApplication({
      features: [feature],
      services: {
        createAudioBackend: () => ({
          load: () => ++loads,
          play: (sound: number) => played.push(sound),
          stop: () => {},
          release: () => {},
          resume: () => {},
        }),
      },
    });
    apps.push(app);
    return import('./beep').then(({ beep }) => {
      beep(app.ctx);
      beep(app.ctx);
      expect(loads).toBe(1);
      expect(played).toEqual([1, 1]);
    });
  });
});

/** Types keys into a field the way MaskedField does: each edit that changes the text calls onChange. */
function typeInto(
  state: MaskedState,
  edits: MaskedEdit[],
  config: typeof SR_FIELD,
  onChange: (text: string) => void,
): { state: MaskedState; beeps: number } {
  let beeps = 0;
  for (const edit of edits) {
    const result = applyMaskedEdit(state, edit, config);
    if (result.beep) beeps++;
    if (result.state.text !== state.text) onChange(result.state.text);
    state = result.state;
  }
  return { state, beeps };
}

describe.runIf(enginesRequired && !enginesBuilt)('engine/dist (EASY68K_REQUIRE_ENGINES=1)', () => {
  it('holds both engines', () => {
    expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist does not hold both engines');
  });
});

describe.skipIf(!enginesBuilt)('register fields wired to the real engine (needs engine/dist)', () => {
  async function bench() {
    const test = await createTestEngine();
    engines.push(test);
    let session: SessionDouble | null = null;
    const app = createTestApplication({
      features: [feature],
      services: { createSimSession: (ctx) => (session = createSessionDouble(ctx, test)) },
    });
    apps.push(app);
    const program = await assembleProgram(['    ORG $1000', 'START:', '    NOP', '    SIMHALT', '    END START']);
    (session as unknown as SessionDouble).controller.loadBytes('/browser/p.S68', program.s68, program.l68);
    return { app, session: session as unknown as SessionDouble, model: simMainOf(app.ctx) };
  }

  it('every keystroke of a hex field is forwarded with editBox; refused keys beep and send nothing', async () => {
    const { session, model } = await bench();
    const edits = session.controller.log;
    const before = edits.length;
    // Focus selects the whole text (autoSelect); "1F" then "z" (refused).
    const { beeps } = typeInto(
      { text: model.view.getState().boxes[Box.D4] ?? '', selStart: 0, selEnd: 8 },
      [
        { type: 'char', char: '1' },
        { type: 'char', char: 'f' },
        { type: 'char', char: 'z' },
      ],
      REGISTER_FIELD as typeof SR_FIELD,
      (text) => model.editRegister(Box.D4, text),
    );
    expect(edits.slice(before)).toEqual(['editBox 4 10000000', 'editBox 4 1F000000']);
    expect(beeps).toBe(1);
    expect(model.view.getState().boxes[Box.D4]).toBe('1F000000');
  }, 60_000);

  it('SR: Backspace types a 0 at the caret, an invalid key types a 0 and beeps; each change reaches the engine', async () => {
    const { session, model } = await bench();
    const start = model.view.getState().boxes[Box.SR] ?? '';
    expect(start).toBe('0010000000000000');
    // Caret before the S bit (position 2): "1" leaves it, then Backspace and "x" type zeros.
    let state: MaskedState = { text: start, selStart: 0, selEnd: 0 };
    const result = typeInto(
      state,
      [{ type: 'char', char: '1' }, { type: 'char', char: '0' }, { type: 'backspace' }],
      SR_FIELD,
      (text) => model.editRegister(Box.SR, text),
    );
    state = result.state;
    expect(state.text).toBe('1000000000000000');
    expect(result.beeps).toBe(0);
    expect(model.view.getState().boxes[Box.SR]).toBe('1000000000000000');
    // The S bit is now 0: the A7 field shows the user stack pointer (regSRChange).
    expect(model.view.getState().boxes[Box.A7]).toBe(model.view.getState().boxes[Box.US]);
    const invalid = typeInto(
      { text: '1111111111111111', selStart: 4, selEnd: 4 },
      [{ type: 'char', char: 'x' }],
      SR_FIELD,
      (text) => model.editRegister(Box.SR, text),
    );
    expect(invalid.beeps).toBe(1);
    expect(invalid.state.text).toBe('1111011111111111');
    expect(session.controller.log.at(-1)).toBe('editBox 19 1111011111111111');
    // Applied at the next run command: with S = 1 and XNZVC = 11111, Trace Into a NOP keeps them.
    model.editRegister(Box.SR, '0010000000011111');
    expect(session.engine.getRegister(Reg.SR)).toBe(0x2000); // only the text so far
    session.controller.traceInto();
    expect(session.engine.getRegister(Reg.SR)).toBe(0x201f);
    expect(model.view.getState().boxes[Box.SR]).toBe('0010000000011111');
  }, 60_000);
});
