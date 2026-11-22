// Part "scan" of the accessibility audit: axe-core over every mode and every dialog of the
// application, in both themes (ARCHITECTURE.md 2.11, 6.6, 6.9 item 8). Owner: Q1.
//
// The scan is not a keyboard test (the walk-throughs are): it reaches each screen the quickest
// way, mostly by running the command a menu item runs (`ctx.commands.run`, the same handler), and
// for two dialogs that only the simulator session opens for a running program (task 58's file
// dialog, the log file question) by opening them with the props of their contract
// (contracts/features.ts SimFileDialogProps, LogFileExistsProps). Every dialog the features
// register is scanned: the list is read from the running application (`dialogComponents`), and
// a dialog without a route here fails the part.
//
// For each dialog it also checks the dialog rules of 2.11: the dialog role, `aria-modal` exactly
// when modal, a title that labels it, the focus inside a modal dialog, Tab and Shift+Tab staying
// inside, and the focus back where it was after Escape.

/* global document, window */

import { AxeBuilder } from '@axe-core/playwright';
import { classify, droppedLabels, findingsOf, isBlocking, partitionDroppedLabels } from './findings.mjs';
import { dialogStack, modeOf, openApp, newContext, shoot, waitFor, waitForApp } from './app.mjs';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A program with one error (line 4), for the Messages panel and the squiggle. */
export const PROGRAM_WITH_ERROR = [
  '*-----------------------------------------------------------',
  '* Title      : audit',
  '*-----------------------------------------------------------',
  '    ORG    $1000',
  'START:',
  "    LEA    PROMPT,A1     ; the prompt's address",
  '    MOVE.B #14,D0',
  '    TRAP   #15',
  '    MOVE.B #4,D0         ; read a number into D1',
  '    TRAP   #15',
  '    MOVE.L D1,D2',
  'LOOP:',
  '    ADDQ.L #1,D3',
  '    BRA    LOOP',
  "PROMPT DC.B 'Number? ',0",
  '    MOVEQ  #1,D9',
  '    END    START',
];
export const PROGRAM = PROGRAM_WITH_ERROR.filter((line) => !line.includes('#1,D9'));

/** Replaces the active document's text (not a keyboard action: the scan only needs the screen). */
const setText = (page, lines) =>
  page.evaluate(
    (text) => {
      const id = window.__easy68k.ctx.store.getState().documents.activeId;
      const view = document.querySelector(`[data-e68-document="${id}"]`).e68View;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    },
    `${lines.join('\n')}\n`,
  );

const run = (page, id, arg) =>
  page.evaluate(
    ([commandId, value]) => {
      // Not awaited: a command that opens a dialog resolves when the dialog closes.
      void window.__easy68k.ctx.commands.run(commandId, value);
    },
    [id, arg],
  );

const focusEditor = (page) =>
  page.evaluate(() => {
    const id = window.__easy68k.ctx.store.getState().documents.activeId;
    document.querySelector(`[data-e68-document="${id}"]`).e68View.focus();
  });

const setMode = async (page, mode) => {
  await page.evaluate((value) => window.__easy68k.ctx.commands.run('app.mode.set', value), mode);
  await waitFor(page, (value) => window.__easy68k.ctx.store.getState().mode === value, mode, 5000);
};

const showPanel = (page, id) =>
  page.evaluate(async (panel) => {
    const { showPanel: show } = await import('/src/state/panels.ts');
    show(window.__easy68k.ctx, panel);
  }, id);
const hidePanel = (page, id) =>
  page.evaluate(async (panel) => {
    const { hidePanel: hide } = await import('/src/state/panels.ts');
    hide(window.__easy68k.ctx, panel);
  }, id);

/** Closes menus and dialogs a step may have left open. */
async function closeAll(page) {
  for (let i = 0; i < 6; i++) {
    const open = await page.evaluate(
      () =>
        document.querySelectorAll('[role=menu][data-e68-menu]').length +
        window.__easy68k.ctx.store.getState().dialogs.stack.length,
    );
    if (open === 0) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
  }
}

/**
 * The route to each dialog the features register: the mode it belongs to and how it is opened.
 * `focus` is where the focus is put before it opens (2.10: it must come back there).
 */
const ROUTES = {
  'about.editor': { mode: 'editor', open: (page) => run(page, 'ed.help.about') },
  'asm.status': {
    mode: 'editor',
    open: async (page) => {
      await setText(page, PROGRAM_WITH_ERROR);
      await focusEditor(page);
      await run(page, 'ed.project.assemble');
    },
    timeout: 60_000,
  },
  'file.open': { mode: 'editor', open: (page) => run(page, 'ed.file.open') },
  'file.save': { mode: 'editor', open: (page) => run(page, 'ed.file.saveAs') },
  find: { mode: 'editor', open: (page) => run(page, 'ed.edit.find'), modal: false },
  replace: { mode: 'editor', open: (page) => run(page, 'ed.edit.replace'), modal: false },
  'print.range': {
    mode: 'editor',
    open: async (page) => {
      await page.evaluate(() => {
        const id = window.__easy68k.ctx.store.getState().documents.activeId;
        const view = document.querySelector(`[data-e68-document="${id}"]`).e68View;
        view.dispatch({ selection: { anchor: 0, head: Math.min(10, view.state.doc.length) } });
        view.focus();
      });
      await run(page, 'ed.file.print');
    },
  },
  'options.assembler': { mode: 'editor', open: (page) => run(page, 'ed.options.assembler'), modal: false },
  'options.editor': { mode: 'editor', open: (page) => run(page, 'ed.options.editor'), tabs: true },
  'settings.transfer': { mode: 'editor', open: (page) => run(page, 'ed.options.transfer') },
  // Move Panel To... (ARCHITECTURE-PLUS P3.1.4, N1)
  'layout.move': { mode: 'editor', open: (page) => run(page, 'app.layout.move') },
  'files.name': {
    mode: 'editor',
    open: (page) => page.locator('[data-e68-panel="files"] button[aria-label="New Folder..."]').first().click(),
    focus: '[data-e68-panel="files"] button[aria-label="New Folder..."]',
  },
  message: {
    mode: 'editor',
    // The close prompt of a modified document (a message box with Yes / No / Cancel).
    open: async (page) => {
      await page.keyboard.type('x');
      await run(page, 'ed.file.close');
    },
  },
  'about.sim': { mode: 'simulator', open: (page) => run(page, 'sim.help.about') },
  'sim.find': { mode: 'simulator', open: (page) => run(page, 'sim.search.find'), modal: false },
  'sim.logOutput': { mode: 'simulator', open: (page) => run(page, 'sim.options.logOutput'), modal: false },
  'sim.logFileExists': {
    mode: 'simulator',
    open: (page) =>
      page.evaluate(() => {
        void window.__easy68k.ctx.dialogs.open('sim.logFileExists', { kind: 'exec', fileName: 'audit.txt' });
      }),
  },
  // Task 58's dialog hands over to the file dialog of the Files feature (file.open on top of it).
  'sim.fileDialog': {
    mode: 'simulator',
    top: 'file.open',
    open: (page) =>
      page.evaluate(() => {
        void window.__easy68k.ctx.dialogs.open('sim.fileDialog', {
          mode: 0,
          title: 'Open',
          filter: 'Text files (*.txt)|*.txt|All files (*.*)|*.*',
          initialName: '',
        });
      }),
  },
  'sim.printerOutput': { mode: 'simulator', open: (page) => run(page, 'sim.file.printerSetup') },
  'sim.speed': { mode: 'simulator', open: (page) => run(page, 'sim.options.speed') },
  'sim.font': { mode: 'simulator', open: (page) => run(page, 'sim.options.sourceFont') },
  'sim.autoTrace': { mode: 'simulator', open: (page) => run(page, 'sim.options.autoTrace') },
  'sim.fullscreen': { mode: 'simulator', open: (page) => run(page, 'sim.options.fullscreen') },
  // DV4's Serial Ports dialog: its command (Options > Serial Ports...) is enabled in the desktop app
  // only, so the audit opens it through the dialog service, with one port and no detected device.
  'desktop-devices.serialPorts': {
    mode: 'simulator',
    open: (page) =>
      page.evaluate(() => {
        void window.__easy68k.ctx.dialogs.open('desktop-devices.serialPorts', {
          map: { COM1: '/dev/cu.usbserial-1' },
          detected: [],
        });
      }),
  },
  'easybin.about': { mode: 'easybin', open: (page) => run(page, 'bin.help.about') },
  // documents.drafts is reached by a reload with an unsaved document (draftsStep below).
};
export const ROUTED_DIALOGS = [...Object.keys(ROUTES), 'documents.drafts'];

/** The element a step puts the focus on before a dialog opens, per mode. */
const FOCUS_BEFORE = {
  editor: '[data-e68-workspace="editor"] .cm-content',
  simulator: '[data-e68-workspace="simulator"] [data-e68-panel="listing"] [role=listbox]',
  easybin: '[data-e68-workspace="easybin"] input',
};

/**
 * One axe scan. Records one check (no new serious or critical finding) and returns the findings.
 * @param {{ check: Function, note: Function }} report
 */
export async function axeScan(page, label, report, all) {
  const analyze = () =>
    new AxeBuilder({ page })
      .withTags(TAGS)
      // The Help panel's frame shows the original's help pages in a sandbox without scripts
      // (2.7): axe cannot run in it and its content is not the port's interface.
      .exclude('.e68-help__frame')
      .analyze();
  let result;
  try {
    result = await analyze();
  } catch {
    // WebKit on a loaded machine: the injected script was not ready. One retry.
    await page.waitForTimeout(1000);
    result = await analyze();
  }
  const findings = findingsOf(result, label);
  all.push(...findings);
  const blocking = [];
  const known = [];
  const other = [];
  for (const finding of findings) {
    const { status, ref } = classify(finding);
    if (status === 'fidelity') continue;
    if (status === 'known') known.push(`${finding.rule} on ${finding.target} (${ref})`);
    else if (isBlocking(finding.impact))
      blocking.push(`${finding.rule} (${finding.impact}) on ${finding.target}: ${finding.summary.slice(0, 160)}`);
    else other.push(`${finding.rule} (${finding.impact}) on ${finding.target}`);
  }
  report.check(
    `axe ${label}: no new serious or critical finding`,
    blocking.length === 0,
    blocking.slice(0, 6).join(' || '),
  );
  // A label on an element whose role takes no name is silently dropped by screen readers; axe
  // leaves it for review (aria-prohibited-attr), so the audit makes it a check of its own.
  // The element of the known defect Q1-6 is judged apart, so that a new element with a dropped
  // label fails here even in a scan of EASyBIN mode.
  const dropped = partitionDroppedLabels(droppedLabels(result));
  report.check(
    `axe ${label}: no aria-label on an element whose role drops it`,
    dropped.other.length === 0,
    dropped.other.slice(0, 4).join(' || '),
  );
  if (dropped.known.length > 0 || /\beasybin\b/.test(label)) {
    report.check(
      `axe ${label}: the File Split digits of EASyBIN have a name that is read`,
      dropped.known.length === 0,
      dropped.known.slice(0, 4).join(' || '),
    );
  }
  if (known.length) console.log(`        known defects: ${[...new Set(known)].join('; ')}`);
  if (other.length) console.log(`        moderate or minor: ${[...new Set(other)].slice(0, 8).join('; ')}`);
  const review = result.incomplete.map((v) => `${v.id} (${v.nodes.length})`);
  if (review.length) console.log(`        needs review (axe could not decide): ${review.join(', ')}`);
  const fidelity = findings.filter((finding) => classify(finding).status === 'fidelity').length;
  if (fidelity)
    console.log(`        fidelity colours (docs/differences/Q1.md): ${fidelity} element(s) in a syntax colour`);
  return findings;
}

/** The structure of the top-most dialog (2.11), read in the page. */
const dialogFacts = (page) =>
  page.evaluate(() => {
    const boxes = [...document.querySelectorAll('[role=dialog], [role=alertdialog]')];
    const box = boxes[boxes.length - 1];
    if (!box) return null;
    const labelId = box.getAttribute('aria-labelledby');
    const title = labelId
      ? (document.getElementById(labelId)?.textContent ?? '')
      : (box.getAttribute('aria-label') ?? '');
    return {
      role: box.getAttribute('role'),
      modal: box.getAttribute('aria-modal'),
      title: title.trim(),
      focusInside: box.contains(document.activeElement),
    };
  });

/** Presses Tab or Shift+Tab `count` times; true if the focus stayed in the top-most dialog. */
async function staysInside(page, key, count) {
  for (let i = 0; i < count; i++) {
    await page.keyboard.press(key);
    const inside = await page.evaluate(() => {
      const boxes = [
        ...document.querySelectorAll('[role=dialog][aria-modal=true], [role=alertdialog][aria-modal=true]'),
      ];
      return boxes.length > 0 && boxes[boxes.length - 1].contains(document.activeElement);
    });
    if (!inside) return false;
  }
  return true;
}

/** Opens one dialog by its route, scans it, checks its rules, closes it with Escape. */
async function dialogStep(page, id, route, prefix, report, all, outDir) {
  const label = `${prefix} dialog ${id}`;
  await closeAll(page);
  if ((await modeOf(page)) !== route.mode) await setMode(page, route.mode);
  const focusSelector = route.focus ?? FOCUS_BEFORE[route.mode];
  await page
    .locator(focusSelector)
    .first()
    .focus()
    .catch(() => {});
  const before = await page.evaluate(() => {
    window.__a11yBefore = document.activeElement;
    return document.activeElement?.tagName ?? 'none';
  });
  await route.open(page);
  const opened = await waitFor(
    page,
    ([dialogId, topId]) => {
      const stack = window.__easy68k.ctx.store.getState().dialogs.stack;
      return stack.some((dialog) => dialog.id === dialogId) && stack[stack.length - 1].id === topId;
    },
    [id, route.top ?? id],
    route.timeout ?? 15_000,
  );
  if (!report.check(`${label}: opens`, opened, opened ? '' : `open dialogs: ${(await dialogStack(page)).join(', ')}`)) {
    await closeAll(page);
    return false;
  }
  await page.waitForTimeout(250);
  const facts = await dialogFacts(page);
  const modal = route.modal !== false;
  report.check(
    `${label}: has the dialog role, aria-modal ${modal ? 'true' : 'absent'}, and a title that labels it`,
    facts !== null &&
      (facts.role === 'dialog' || facts.role === 'alertdialog') &&
      (modal ? facts.modal === 'true' : facts.modal !== 'true') &&
      facts.title !== '',
    JSON.stringify(facts),
  );
  await axeScan(page, label, report, all);
  if (route.tabs) {
    const tabs = await page.locator('[role=dialog] [role=tab]').all();
    for (const [index, tabElement] of tabs.entries()) {
      if (index === 0) continue;
      await tabElement.click();
      await page.waitForTimeout(150);
      await axeScan(page, `${label} tab ${(await tabElement.innerText()).trim()}`, report, all);
    }
  }
  if (modal) {
    report.check(
      `${label}: the focus is inside the dialog`,
      facts?.focusInside === true,
      `focus was on ${before} before`,
    );
    const forward = await staysInside(page, 'Tab', 12);
    const backward = await staysInside(page, 'Shift+Tab', 12);
    report.check(
      `${label}: Tab and Shift+Tab keep the focus inside`,
      forward && backward,
      `Tab ${forward}, Shift+Tab ${backward}`,
    );
  }
  await shoot(page, outDir, label.replace(/[^\w.-]+/g, '-'));
  // Escape closes it; the focus goes back to where it was (2.10).
  if (!modal) {
    await page
      .locator('[role=dialog]')
      .last()
      .locator('button, input, select, [tabindex]')
      .first()
      .focus()
      .catch(() => {});
  }
  await page.keyboard.press('Escape');
  const closed = await waitFor(
    page,
    (dialogId) => !window.__easy68k.ctx.store.getState().dialogs.stack.some((dialog) => dialog.id === dialogId),
    id,
    5000,
  );
  const back = await page.evaluate(() => {
    const element = document.activeElement;
    const was = window.__a11yBefore;
    return {
      same: Boolean(was) && was !== document.body && (element === was || was.contains(element)),
      now: element
        ? `${element.tagName.toLowerCase()} ${element.getAttribute('aria-label') ?? element.className ?? ''}`.slice(
            0,
            80,
          )
        : 'none',
    };
  });
  report.check(`${label}: Escape closes it`, closed);
  if (closed) {
    report.check(`${label}: the focus returns to where it was`, back.same, `focus now on ${back.now}`);
  }
  await closeAll(page);
  return true;
}

/** Assembles the active document and executes it (Execute in the status dialog; Caution OK). */
export async function assembleAndExecute(page, lines) {
  await setMode(page, 'editor');
  await setText(page, lines);
  await focusEditor(page);
  await run(page, 'ed.project.assemble');
  const dialog = page.locator('[role=dialog].e68-asm-status');
  await dialog.waitFor({ timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Execute', exact: true }).click();
  await page.waitForTimeout(200);
  const caution = page.locator('[role=alertdialog]', { hasText: 'debug environment will be lost' });
  if ((await caution.count()) > 0) await caution.getByRole('button', { name: 'OK' }).click();
  return waitFor(
    page,
    () => {
      const s = window.__easy68k.ctx.store.getState();
      return s.mode === 'simulator' && s.sim.program !== null && s.sim.phase === 'idle';
    },
    null,
    60_000,
  );
}

/**
 * The scan part for one browser: both themes, every mode and every dialog.
 * @returns {Promise<{ findings: any[], covered: Set<string>, registered: string[] }>}
 */
export async function scanPart({ browser, name, os, baseUrl, report, outDir, enginesPresent }) {
  const all = [];
  const covered = new Set();
  let registered = [];
  for (const theme of ['light', 'dark']) {
    const prefix = `${name} ${theme}`;
    console.log(`\n[${name}, ${os} key map, ${theme} theme: scan]`);
    const context = await newContext(browser, os);
    const { page, errors } = await openApp(context, baseUrl);
    try {
      await page.evaluate((value) => window.__easy68k.ctx.commands.run('app.theme.set', value), theme);
      await waitFor(page, (value) => document.documentElement.getAttribute('data-theme') === value, theme, 5000);
      registered = await page.evaluate(() => [...window.__easy68k.dialogComponents.keys()].sort());

      // Editor mode: the start-up document, then with the messages of an assembly.
      await axeScan(page, `${prefix} editor`, report, all);
      await shoot(page, outDir, `${prefix}-editor`.replace(/\s+/g, '-'));
      for (const [id, route] of Object.entries(ROUTES)) {
        if (route.mode !== 'editor' || id === 'message' || id === 'files.name') continue;
        if (await dialogStep(page, id, route, prefix, report, all, outDir)) covered.add(id);
        if (id === 'asm.status') {
          await axeScan(page, `${prefix} editor with assembler messages`, report, all);
          await shoot(page, outDir, `${prefix}-editor-messages`.replace(/\s+/g, '-'));
        }
      }
      if (await dialogStep(page, 'files.name', ROUTES['files.name'], prefix, report, all, outDir))
        covered.add('files.name');
      await showPanel(page, 'help');
      await page.waitForTimeout(500);
      await axeScan(page, `${prefix} editor with the Help panel`, report, all);
      await shoot(page, outDir, `${prefix}-help`.replace(/\s+/g, '-'));
      await hidePanel(page, 'help');

      if (!enginesPresent) {
        report.note(`${prefix}: engine/dist is missing - Simulator mode is scanned without a program`);
      } else {
        const executed = await assembleAndExecute(page, PROGRAM);
        report.check(`${prefix}: the audit program is loaded in Simulator mode`, executed);
      }
      await setMode(page, 'simulator');
      for (const panel of ['memory', 'stack', 'hardware', 'breakpoints', 'log']) {
        await run(page, `sim.view.${panel}`);
        await page.waitForTimeout(100);
      }
      await axeScan(page, `${prefix} simulator with every tool panel`, report, all);
      await shoot(page, outDir, `${prefix}-simulator`.replace(/\s+/g, '-'));
      // Each tool tab in front once.
      for (const tabElement of await page.locator('[data-e68-workspace="simulator"] [role=tablist] [role=tab]').all()) {
        await tabElement.click();
        await page.waitForTimeout(150);
        await axeScan(page, `${prefix} simulator tool tab ${(await tabElement.innerText()).trim()}`, report, all);
      }
      if (enginesPresent) {
        // A program waiting for input; Editor mode shows the toast of 2.10.
        await run(page, 'sim.run.run');
        const waiting = await waitFor(
          page,
          () => window.__easy68k.ctx.store.getState().sim.phase === 'waitInput',
          null,
          20_000,
        );
        report.check(`${prefix}: the audit program waits for input`, waiting);
        await axeScan(page, `${prefix} simulator, program waiting for input`, report, all);
        // The toast of 2.10 appears when a keyboard-input task starts while Editor mode is in
        // front: rewind, go to Editor mode, run from there.
        await run(page, 'sim.run.rewind');
        await waitFor(page, () => window.__easy68k.ctx.store.getState().sim.phase === 'idle', null, 10_000);
        await setMode(page, 'editor');
        await run(page, 'sim.run.run');
        const toast = await waitFor(
          page,
          () => document.body.innerText.includes('The program is waiting for keyboard input'),
          null,
          10_000,
        );
        report.check(
          `${prefix}: Editor mode shows the waiting-for-input toast (2.10)`,
          toast,
          `mode ${await modeOf(page)}`,
        );
        await axeScan(page, `${prefix} editor with the waiting-for-input toast`, report, all);
        await shoot(page, outDir, `${prefix}-toast`.replace(/\s+/g, '-'));
        await setMode(page, 'simulator');
        await run(page, 'sim.run.pause');
        await waitFor(page, () => window.__easy68k.ctx.store.getState().sim.phase === 'idle', null, 10_000);
      }
      for (const [id, route] of Object.entries(ROUTES)) {
        if (route.mode !== 'simulator') continue;
        if (await dialogStep(page, id, route, prefix, report, all, outDir)) covered.add(id);
      }
      // Narrow window (2.3: below 1100 px the columns stack and the tool tabs join the Output panel).
      await page.setViewportSize({ width: 1000, height: 800 });
      await page.waitForTimeout(300);
      await axeScan(page, `${prefix} simulator below 1100 px`, report, all);
      await shoot(page, outDir, `${prefix}-simulator-narrow`.replace(/\s+/g, '-'));
      await page.setViewportSize({ width: 1400, height: 900 });

      await setMode(page, 'easybin');
      await axeScan(page, `${prefix} easybin`, report, all);
      await shoot(page, outDir, `${prefix}-easybin`.replace(/\s+/g, '-'));
      if (await dialogStep(page, 'easybin.about', ROUTES['easybin.about'], prefix, report, all, outDir))
        covered.add('easybin.about');

      // The close prompt (a message box) and, after a reload with an unsaved document, the drafts offer.
      await setMode(page, 'editor');
      if (await dialogStep(page, 'message', ROUTES.message, prefix, report, all, outDir)) covered.add('message');
      if (await draftsStep(page, prefix, report, all, outDir)) covered.add('documents.drafts');

      report.check(`${prefix}: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
    } finally {
      await context.close();
    }
  }
  return { findings: all, covered, registered };
}

/** documents.drafts: a modified document, the draft written (2 s), the page reloaded. */
async function draftsStep(page, prefix, report, all, outDir) {
  await focusEditor(page);
  await page.keyboard.type('* draft');
  await page.waitForTimeout(3500);
  await page.reload();
  await waitForApp(page);
  const offered = await waitFor(
    page,
    () => window.__easy68k.ctx.store.getState().dialogs.stack.some((dialog) => dialog.id === 'documents.drafts'),
    null,
    15_000,
  );
  if (!report.check(`${prefix} dialog documents.drafts: offered after a reload with an unsaved document`, offered)) {
    return false;
  }
  await page.waitForTimeout(250);
  const facts = await dialogFacts(page);
  report.check(
    `${prefix} dialog documents.drafts: has the dialog role, aria-modal true, and a title that labels it`,
    facts !== null && facts.modal === 'true' && facts.title !== '',
    JSON.stringify(facts),
  );
  await axeScan(page, `${prefix} dialog documents.drafts`, report, all);
  report.check(`${prefix} dialog documents.drafts: the focus is inside the dialog`, facts?.focusInside === true);
  const forward = await staysInside(page, 'Tab', 8);
  report.check(`${prefix} dialog documents.drafts: Tab keeps the focus inside`, forward);
  await shoot(page, outDir, `${prefix}-dialog-documents.drafts`.replace(/\s+/g, '-'));
  await page.keyboard.press('Escape');
  return true;
}
