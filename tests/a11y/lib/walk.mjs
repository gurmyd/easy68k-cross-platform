// The two keyboard-only walk-throughs of the accessibility audit (ARCHITECTURE.md 9.6 Q1
// acceptance; 2.9, 2.10, 2.11). Owner: Q1.
//
//   walk-edit  "edit, assemble, fix an error": from a freshly opened application, reach the editor
//              with Tab, type a program that has an error, assemble it with the key map's chord,
//              read the status dialog and close it, leave the editor (Esc, Tab) for the Messages
//              panel, select the message, jump to its line with Enter, correct the line, assemble
//              again: no error, Execute enabled.
//   walk-run   "run, answer input, leave the Output panel with the release chord, set a
//              breakpoint, step": type and assemble a program that asks for a number and then
//              loops, Execute from the status dialog, Run, answer the prompt in the Output panel,
//              leave it with the release chord (2.9.4 rule 1), select the loop's first row in the
//              Listing and set a breakpoint with Space; the running program stops there; Step Over
//              and Trace Into move the PC.
//
// Only the keyboard acts. The page object is read to check what happened (the registers, the
// listing's addresses, the dialog stack) and never to act. Each walk-through runs on the Windows
// and on the macOS key map; the chords come from chordsOn() in the page. On the macOS key map Tab
// moves as Safari's default does (lib/app.mjs tab()).

/* global document, window */

import { closeWithin } from '../../browser-checks/ending.mjs';
import {
  describeFocus,
  dialogStack,
  editorText,
  focusOf,
  modeOf,
  newContext,
  openApp,
  pressCommand,
  primary,
  shoot,
  STEP_TIMEOUT,
  tabUntil,
  typeLines,
  waitFor,
} from './app.mjs';

/** The program of walk-edit; line 9 has the error (D9 is no register). */
export const EDIT_PROGRAM = [
  '    ORG    $1000',
  'START:',
  '    MOVEQ  #5,D0',
  '    ADD.L  D0,D0',
  '    SIMHALT',
  '    END    START',
];
/** The line with the error, inserted after line 4 (1-based line 5 of the document). */
export const ERROR_LINE = { at: 4, bad: '    MOVE.L D0,D9', good: '    MOVE.L D0,D1' };

/** The program of walk-run: a prompt, a number read with task 4, then an endless loop. */
export const RUN_PROGRAM = [
  '    ORG    $1000',
  'START:',
  '    LEA    PROMPT,A1',
  '    MOVE.B #14,D0',
  '    TRAP   #15',
  '    MOVE.B #4,D0',
  '    TRAP   #15',
  '    MOVE.L D1,D2',
  'LOOP:',
  '    ADDQ.L #1,D3',
  '    BRA    LOOP',
  "PROMPT DC.B 'Number? ',0",
  '    END    START',
];

const lineOfCaret = (page) =>
  page.evaluate(() => {
    const id = window.__easy68k.ctx.store.getState().documents.activeId;
    const view = document.querySelector(`[data-e68-document="${id}"]`).e68View;
    const range = view.state.selection.main;
    return { line: view.state.doc.lineAt(range.head).number, selected: view.state.sliceDoc(range.from, range.to) };
  });

const statusDialog = (page) => page.locator('[role=dialog].e68-asm-status');
const statusFacts = async (page) => {
  const dialog = statusDialog(page);
  return {
    errors: (await dialog.locator('[data-e68-count=errors]').innerText()).trim(),
    warnings: (await dialog.locator('[data-e68-count=warnings]').innerText()).trim(),
    executeEnabled: await dialog.getByRole('button', { name: 'Execute', exact: true }).isEnabled(),
  };
};
const inEditor = (focus) => focus.panel === 'editor' && focus.what.startsWith('textbox');

/** Tab from the start of the page into the editor, then the program typed over the template. */
async function reachEditorAndType(page, os, p, report, lines) {
  const reached = await tabUntil(page, os, inEditor, 30);
  report.check(
    `${p} Tab from the start of the page reaches the editor`,
    reached !== null,
    describeFocus(await focusOf(page)),
  );
  if (!reached) return false;
  await page.keyboard.press(`${primary(os)}+KeyA`);
  await page.keyboard.press('Delete');
  await typeLines(page, lines);
  const text = (await editorText(page)) ?? '';
  const ok = text.replace(/\s+$/, '') === lines.join('\n');
  report.check(`${p} the program is typed into the editor`, ok, ok ? '' : JSON.stringify(text.slice(0, 200)));
  return ok;
}

/** Assembles with the key map's chord; returns the status dialog's facts or null. */
async function assembleByKey(page, p, report, label) {
  const chord = await pressCommand(page, 'ed.project.assemble');
  const shown = await statusDialog(page)
    .waitFor({ timeout: 60_000 })
    .then(
      () => true,
      () => false,
    );
  report.check(
    `${p} ${chord} assembles and shows the Assembler Status dialog (${label})`,
    shown,
    (await dialogStack(page)).join(', '),
  );
  if (!shown) return null;
  const focus = await focusOf(page);
  report.check(
    `${p} the focus is in the Assembler Status dialog (${label})`,
    focus.dialog !== null,
    describeFocus(focus),
  );
  return statusFacts(page);
}

/** walk-edit: "edit, assemble, fix an error". */
export async function walkEdit({ browser, name, os, baseUrl, report, outDir }) {
  const p = `${name}/${os} walk-edit:`;
  console.log(`\n[${name}, ${os} key map: keyboard-only walk-through "edit, assemble, fix an error"]`);
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context, baseUrl);
  try {
    const lines = [...EDIT_PROGRAM.slice(0, ERROR_LINE.at), ERROR_LINE.bad, ...EDIT_PROGRAM.slice(ERROR_LINE.at)];
    if (!(await reachEditorAndType(page, os, p, report, lines))) return;

    // Assemble: one error, Execute disabled.
    const first = await assembleByKey(page, p, report, 'with the error');
    if (!first) return;
    report.check(
      `${p} the dialog reports 1 error and Execute is disabled`,
      first.errors === '1' && !first.executeEnabled,
      JSON.stringify(first),
    );
    await shoot(page, outDir, `${name}-${os}-walk-edit-status-error`);
    // Tab to Close and press Enter (inside a modal dialog Tab reaches every button, also in Safari).
    const close = await tabUntil(page, os, (focus) => focus.dialog !== null && focus.what.includes('Close'), 6);
    report.check(`${p} Tab reaches Close in the dialog`, close !== null, describeFocus(await focusOf(page)));
    await page.keyboard.press('Enter');
    const closed = await waitFor(
      page,
      () => window.__easy68k.ctx.store.getState().dialogs.stack.length === 0,
      null,
      5000,
    );
    const back = await focusOf(page);
    report.check(
      `${p} Enter on Close closes the dialog and the focus is back in the editor`,
      closed && inEditor(back),
      describeFocus(back),
    );

    // Leave the editor: Esc, then Tab (the editor keeps Tab for indenting otherwise).
    await page.keyboard.press('Escape');
    const grid = await tabUntil(page, os, (focus) => focus.panel === 'messages' && focus.what.startsWith('grid'), 6);
    report.check(
      `${p} Esc then Tab leaves the editor and reaches the Messages panel`,
      grid !== null,
      describeFocus(await focusOf(page)),
    );
    if (!grid) return;
    await page.keyboard.press('ArrowDown');
    const selected = await page.evaluate(() => {
      const row = document.querySelector('[data-e68-panel="messages"] [role=row][aria-selected=true]');
      return row ? row.textContent.replace(/\s+/g, ' ').trim() : null;
    });
    report.check(
      `${p} Down selects the message, which names line ${ERROR_LINE.at + 1} and says ERROR`,
      selected !== null && selected.startsWith(String(ERROR_LINE.at + 1)) && selected.includes('ERROR'),
      `${selected}`,
    );
    await shoot(page, outDir, `${name}-${os}-walk-edit-messages`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    const atLine = await lineOfCaret(page);
    const inEditorNow = inEditor(await focusOf(page));
    report.check(
      `${p} Enter on the message puts the caret on line ${ERROR_LINE.at + 1} in the editor`,
      inEditorNow && atLine.line === ERROR_LINE.at + 1,
      `${JSON.stringify(atLine)}, focus ${describeFocus(await focusOf(page))}`,
    );

    // Correct the line: End, Shift+Home (to the end of the indentation), type the instruction.
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.type(ERROR_LINE.good.trimStart());
    const fixed = ((await editorText(page)) ?? '').split('\n')[ERROR_LINE.at];
    report.check(`${p} the line is corrected with the keyboard`, fixed === ERROR_LINE.good, JSON.stringify(fixed));

    // Assemble again: no error, Execute enabled; Escape closes; the messages are gone.
    const second = await assembleByKey(page, p, report, 'corrected');
    if (!second) return;
    report.check(
      `${p} the dialog reports 0 errors and Execute is enabled`,
      second.errors === '0' && second.executeEnabled,
      JSON.stringify(second),
    );
    await shoot(page, outDir, `${name}-${os}-walk-edit-status-clean`);
    await page.keyboard.press('Escape');
    const gone = await waitFor(
      page,
      () => window.__easy68k.ctx.store.getState().dialogs.stack.length === 0,
      null,
      5000,
    );
    const messages = await page.evaluate(() => {
      const state = window.__easy68k.ctx.store.getState();
      return (state.messages[state.documents.activeId] ?? []).length;
    });
    const marks = await page.locator('[data-e68-workspace="editor"] .e68-squiggle').count();
    report.check(
      `${p} Escape closes the dialog; no message and no error mark are left`,
      gone && messages === 0 && marks === 0,
      `messages ${messages}, marks ${marks}`,
    );
    report.check(
      `${p} the focus is back in the editor`,
      inEditor(await focusOf(page)),
      describeFocus(await focusOf(page)),
    );
    report.check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await shoot(page, outDir, `${name}-${os}-walk-edit-end`);
    await closeWithin(context);
  }
}

/** The listing's rows as the page shows them: index, text, breakpoint mark, address. */
const listingRows = (page) =>
  page.evaluate(() => {
    const { ctx } = window.__easy68k;
    return [...document.querySelectorAll('[data-e68-panel="listing"] [role=option]')].map((row) => {
      const index = Number(row.getAttribute('data-row'));
      return {
        index,
        text: row.textContent ?? '',
        bp: row.getAttribute('data-bp'),
        selected: row.getAttribute('aria-selected') === 'true',
        address: index > 2 && ctx.sim.listing.isInstruction(index) ? ctx.sim.listing.addressOf(index) : null,
      };
    });
  });
const registers = (page) => page.evaluate(() => window.__easy68k.ctx.sim.engine.registers());
const phase = (page) => page.evaluate(() => window.__easy68k.ctx.store.getState().sim.phase);

/** walk-run: "run, answer input, leave the Output panel with the release chord, set a breakpoint, step". */
export async function walkRun({ browser, name, os, baseUrl, report, outDir }) {
  const p = `${name}/${os} walk-run:`;
  console.log(
    `\n[${name}, ${os} key map: keyboard-only walk-through "run, answer input, leave the Output panel, set a breakpoint, step"]`,
  );
  const context = await newContext(browser, os);
  const { page, errors } = await openApp(context, baseUrl);
  try {
    if (!(await reachEditorAndType(page, os, p, report, RUN_PROGRAM))) return;
    const status = await assembleByKey(page, p, report, 'the input program');
    if (!status) return;
    report.check(
      `${p} the program assembles without error`,
      status.errors === '0' && status.executeEnabled,
      JSON.stringify(status),
    );

    // Execute: Tab to it (it may already have the focus) and Enter.
    const onExecute = (focus) => focus.dialog !== null && focus.what.includes('Execute');
    const execute = onExecute(await focusOf(page)) ? await focusOf(page) : await tabUntil(page, os, onExecute, 6);
    report.check(
      `${p} Execute in the dialog is reached with the keyboard`,
      execute !== null,
      describeFocus(await focusOf(page)),
    );
    await page.keyboard.press('Enter');
    const loaded = await waitFor(
      page,
      () => {
        const s = window.__easy68k.ctx.store.getState();
        return s.mode === 'simulator' && s.sim.program !== null && s.sim.phase === 'idle';
      },
      null,
      60_000,
    );
    report.check(`${p} Enter on Execute loads the program in Simulator mode`, loaded, `mode ${await modeOf(page)}`);
    if (!loaded) return;
    const afterExecute = await focusOf(page);
    report.check(
      `${p} after Execute the focus is in a panel of Simulator mode`,
      afterExecute.panel !== null,
      describeFocus(afterExecute),
    );
    await shoot(page, outDir, `${name}-${os}-walk-run-loaded`);

    // Run: the Output panel takes the focus (2.10) and the program waits for its number.
    const runChord = await pressCommand(page, 'sim.run.run');
    const waiting = await waitFor(
      page,
      () => window.__easy68k.ctx.store.getState().sim.phase === 'waitInput',
      null,
      STEP_TIMEOUT,
    );
    const atOutput = await focusOf(page);
    report.check(
      `${p} ${runChord} runs the program; it waits for input with the focus in the Output panel`,
      waiting && atOutput.panel === 'output',
      `phase ${await phase(page)}, focus ${describeFocus(atOutput)}`,
    );
    // The mirror is updated at most twice a second (2.11).
    await waitFor(
      page,
      () => document.querySelector('[data-e68-panel="output"] [role=log]')?.textContent?.includes('Number?') === true,
      null,
      3000,
    );
    const prompt = await page.evaluate(() =>
      [...document.querySelectorAll('[data-e68-panel="output"] [role=log] > div')]
        .map((row) => row.textContent.trim())
        .join('|'),
    );
    report.check(
      `${p} the prompt is in the Output panel's text mirror`,
      prompt.startsWith('Number?'),
      JSON.stringify(prompt),
    );
    await page.keyboard.type('42', { delay: 60 });
    await page.keyboard.press('Enter', { delay: 60 });
    // The engine has D1 at once when the key is delivered (a timer tick), but the store's phase is
    // published at the next display frame (4.6, erratum SH8 18), 60 to 130 ms later on GitHub's Mac
    // runner. So wait for both, and print how long after the engine had D1 the phase came (erratum
    // SH8 49). (The Registers panel shows no new values while the program runs, as in the original.)
    await page.evaluate(() => {
      const record = { engineAt: null, shownAt: null };
      window.__walkAnswer = record;
      const until = performance.now() + 60_000;
      const look = () => {
        const now = performance.now();
        if (now > until) return;
        if (record.engineAt === null && window.__easy68k.ctx.sim.engine.registers().d[1] === 42) record.engineAt = now;
        if (record.engineAt !== null && window.__easy68k.ctx.store.getState().sim.phase === 'running') {
          record.shownAt = now;
          return;
        }
        setTimeout(look, 1);
      };
      look();
    });
    const answered = await waitFor(
      page,
      () =>
        window.__easy68k.ctx.sim.engine.registers().d[1] === 42 &&
        window.__easy68k.ctx.store.getState().sim.phase === 'running',
      null,
      STEP_TIMEOUT,
    );
    const lag = await page.evaluate(() => {
      const { engineAt, shownAt } = window.__walkAnswer;
      return engineAt === null || shownAt === null ? 'not measured' : `${Math.round(shownAt - engineAt)} ms`;
    });
    report.check(
      `${p} the typed answer reaches the program (D1 = 42) and it goes on running`,
      answered,
      `D1 = ${(await registers(page)).d[1]}, phase ${await phase(page)}; the phase was published ${lag} after the engine had D1`,
    );
    await shoot(page, outDir, `${name}-${os}-walk-run-answered`);

    // The release chord: the focus leaves the Output panel; the program keeps running.
    const stepsBefore = await page.evaluate(() => window.__easy68k.ctx.sim.engine.stepCount);
    const releaseChord = await pressCommand(page, 'sim.output.releaseKeyboard');
    await page.waitForTimeout(200);
    const released = await focusOf(page);
    report.check(
      `${p} ${releaseChord} moves the focus out of the Output panel, to the Listing`,
      released.panel === 'listing',
      describeFocus(released),
    );
    const stillRunning =
      (await phase(page)) === 'running' &&
      (await waitFor(page, (before) => window.__easy68k.ctx.sim.engine.stepCount !== before, stepsBefore, 5000));
    report.check(
      `${p} the program is still running after the release chord`,
      stillRunning,
      `phase ${await phase(page)}`,
    );
    if (released.panel !== 'listing') {
      // Reach the Listing with the next-panel key, so that the rest can still be checked.
      for (let i = 0; i < 6 && (await focusOf(page)).panel !== 'listing'; i++)
        await pressCommand(page, 'sim.panel.next');
    }

    // A breakpoint on the loop's first instruction, by the keyboard: arrows to its row, Space.
    let rows = await listingRows(page);
    const target = rows.find((row) => /ADDQ\.L/.test(row.text) && row.address !== null);
    const branch = rows.find((row) => /BRA\s+LOOP/.test(row.text) && row.address !== null);
    if (!report.check(`${p} the listing shows the loop`, Boolean(target && branch), `${rows.length} rows`)) return;
    const from = rows.find((row) => row.selected)?.index ?? -1;
    const key = target.index > from ? 'ArrowDown' : 'ArrowUp';
    for (let i = 0; i < Math.abs(target.index - from); i++) await page.keyboard.press(key);
    rows = await listingRows(page);
    report.check(
      `${p} the arrow keys select the loop's row in the Listing`,
      rows.find((row) => row.selected)?.index === target.index,
      `selected ${rows.find((row) => row.selected)?.index}, wanted ${target.index}`,
    );
    await page.keyboard.press('Space');
    const stopped = await waitFor(
      page,
      (address) =>
        window.__easy68k.ctx.store.getState().sim.phase === 'idle' &&
        window.__easy68k.ctx.sim.engine.registers().pc === address,
      target.address,
      STEP_TIMEOUT,
    );
    rows = await listingRows(page);
    const regs = await registers(page);
    report.check(
      `${p} Space sets a breakpoint on the row (shown in the gutter)`,
      rows.find((row) => row.index === target.index)?.bp === 'on',
      `bp ${rows.find((row) => row.index === target.index)?.bp}`,
    );
    report.check(
      `${p} the running program stops at the breakpoint`,
      stopped,
      `phase ${await phase(page)}, PC ${regs.pc.toString(16)}, wanted ${target.address.toString(16)}`,
    );
    await shoot(page, outDir, `${name}-${os}-walk-run-breakpoint`);
    if (!stopped) return;

    // Step Over, then Trace Into: the PC moves, the loop counts, the focus stays (2.10).
    const d3 = regs.d[3];
    const focusBefore = await focusOf(page);
    const stepChord = await pressCommand(page, 'sim.run.stepOver');
    const stepped = await waitFor(
      page,
      (address) =>
        window.__easy68k.ctx.store.getState().sim.phase === 'idle' &&
        window.__easy68k.ctx.sim.engine.registers().pc === address,
      branch.address,
      STEP_TIMEOUT,
    );
    const afterStep = await registers(page);
    report.check(
      `${p} ${stepChord} (Step Over) executes ADDQ: PC on BRA, D3 one more`,
      stepped && afterStep.d[3] === (d3 + 1) >>> 0,
      `PC ${afterStep.pc.toString(16)}, D3 ${d3} -> ${afterStep.d[3]}`,
    );
    const traceChord = await pressCommand(page, 'sim.run.traceInto');
    const traced = await waitFor(
      page,
      (address) =>
        window.__easy68k.ctx.store.getState().sim.phase === 'idle' &&
        window.__easy68k.ctx.sim.engine.registers().pc === address,
      target.address,
      STEP_TIMEOUT,
    );
    report.check(
      `${p} ${traceChord} (Trace Into) executes BRA: PC back on ADDQ`,
      traced,
      `PC ${(await registers(page)).pc.toString(16)}`,
    );
    rows = await listingRows(page);
    report.check(
      `${p} the Listing's selected row follows the PC`,
      rows.find((row) => row.selected)?.index === target.index,
      `selected ${rows.find((row) => row.selected)?.index}`,
    );
    const focusAfter = await focusOf(page);
    report.check(
      `${p} stepping leaves the focus where it was (2.10)`,
      focusAfter.panel === focusBefore.panel,
      `${describeFocus(focusBefore)} -> ${describeFocus(focusAfter)}`,
    );
    await shoot(page, outDir, `${name}-${os}-walk-run-stepped`);
    report.check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  } finally {
    await shoot(page, outDir, `${name}-${os}-walk-run-end`);
    await closeWithin(context);
  }
}
