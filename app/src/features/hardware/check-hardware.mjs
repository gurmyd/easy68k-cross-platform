// Browser check of the Hardware panel (ARCHITECTURE.md 9.2, SH7). Owner: SH7.
//
//   node app/src/features/hardware/check-hardware.mjs [--browser chromium|webkit|all] [--out <dir>]
//
// Starts the Vite development server of app/ on a free port and drives the real application in
// headless Chromium and WebKit (Playwright). What unit tests under Node cannot show:
//
//   1. With the shell's own (inert) simulator session: View > Hardware shows the panel with every
//      control of hardware §5 (64 segments, 8 LEDs, bit labels, 8 switches, 8 push buttons, four
//      address fields with their '00' prefix, 7 IRQ buttons with 7 check boxes and the Automatic
//      label, the Auto Interval field and level list, Reset, and the Memory Map rows); an
//      accessibility scan of the panel in both themes.
//   2. With the real simulator engine: the panel's own session parts are swapped for the real engine,
//      a real HardwareModel and the test controller of core/sim-host/hardware/testing.ts, driven once
//      per display frame. Then: segments and LEDs follow a running program; the panel repaints after
//      a write that causes no host call (writeBytes); a real click on a switch sets its bit; a held
//      push button reads 0 and is released by pointer up and by pointer cancel; typing an address
//      colours conflicting fields red; showing the panel zeroes the switch byte and keeps the
//      pictures; the Automatic label follows Run and Pause; IRQ and Reset are disabled after
//      SIMHALT.
//
// Screenshots go to build/SH7/hardware-check (git-ignored). Prints "N of M checks passed"; exit
// code 0 = everything passed and no console error.

/* global console, process, document, window, requestAnimationFrame, getComputedStyle, PointerEvent -- the browser globals are used inside page.evaluate() callbacks */

import { existsSync, mkdirSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium, webkit } from '@playwright/test';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '../../..');
const repoRoot = resolve(appRoot, '..');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const browserChoice = option('--browser', 'all');
const outDir = resolve(option('--out', join(repoRoot, 'build', 'SH7', 'hardware-check')));
mkdirSync(outDir, { recursive: true });

/** Part 2 needs both engines; without them it is skipped, or fails when EASY68K_REQUIRE_ENGINES=1. */
const enginesBuilt = ['sim68k.wasm', 'sim68k-loader.mjs', 'asm68k.wasm', 'asm68k-loader.mjs'].every((file) =>
  existsSync(join(repoRoot, 'engine', 'dist', file)),
);

const BROWSERS = { chromium, webkit };
const browsers = browserChoice === 'all' ? ['chromium', 'webkit'] : [browserChoice];

let baseUrl = '';
/** The console and page errors of the page opened last (printed when a pass stops early). */
let pageErrors = [];
let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

/** A free TCP port, found by asking the system for one. */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

function pretendWindows() {
  Object.defineProperty(window.Navigator.prototype, 'platform', { get: () => 'Win32' });
  Object.defineProperty(window.Navigator.prototype, 'userAgentData', { get: () => undefined });
}

async function openApp(browser) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1300 }, reducedMotion: 'reduce' });
  await context.addInitScript(pretendWindows);
  const page = await context.newPage();
  const errors = [];
  pageErrors = errors;
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForSelector('.e68-shell', { timeout: 120_000 });
  await page.waitForFunction(() => window.__easy68k !== undefined);
  return { context, page, errors };
}

async function scanPanel(page, label) {
  const result = await new AxeBuilder({ page })
    .include('.e68-hw')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  const describe = (list) =>
    list.map(
      (v) =>
        `${v.id} (${v.impact}, ${v.nodes.length}): ${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(' | ')}`,
    );
  check(`axe ${label}: no serious finding in the panel`, serious.length === 0, describe(serious).join('; '));
  const other = result.violations.filter((v) => !serious.includes(v));
  if (other.length) console.log(`        minor findings: ${describe(other).join('; ')}`);
}

/** What the panel shows, read from the DOM. */
function readPanel(page) {
  return page.evaluate(() => {
    const root = document.querySelector('.e68-hw');
    if (!root) return null;
    const all = (selector) => Array.from(root.querySelectorAll(selector));
    const litSegments = (digit) =>
      all(`[data-digit="${digit}"] rect`)
        .filter((r) => r.classList.contains('e68-hw__lamp--on'))
        .map((r) => r.getAttribute('data-segment'))
        .join('');
    return {
      segments: all('rect[data-segment]').length,
      digits: [0, 1, 2, 3, 4, 5, 6, 7].map(litSegments),
      leds: all('circle[data-led]').length,
      ledsOn: all('circle[data-led]')
        .filter((c) => c.classList.contains('e68-hw__lamp--on'))
        .map((c) => Number(c.getAttribute('data-led'))),
      bitLabels: all('.e68-hw__device--switches .e68-hw__bit').map((e) => e.textContent),
      switches: all('[data-switch]').map((e) => e.getAttribute('aria-checked')),
      pushButtons: all('[data-pb]').length,
      addresses: all('input[data-hw-address]').map((e) => e.value),
      prefixes: all('.e68-hw__address .e68-masked__prefix').map((e) => e.textContent),
      addressLabels: all('.e68-hw__address .e68-field-label__text').map((e) => e.textContent),
      irq: all('[data-irq]').map((e) => `${e.getAttribute('data-irq')}${e.disabled ? 'd' : ''}`),
      reset: all('button[aria-label="Reset"]').map((e) => (e.disabled ? 'disabled' : 'enabled')),
      autoChecks: all('input[data-auto]').map((e) => e.checked),
      autoLabel: root.querySelector('[data-hw-auto-label]')?.textContent ?? null,
      interval: root.querySelector('input[data-hw-interval]')?.value ?? null,
      level: root.querySelector('select[data-hw-level]')?.value ?? null,
      levelOptions: all('select[data-hw-level] option').map((o) => o.textContent),
      legends: all('legend').map((e) => e.textContent),
      mapChecks: all('input[data-map]').length,
      mapFields: all('input[data-map-start], input[data-map-end]').map((e) => e.value),
      mapLabels: all('.e68-hw__map .e68-checkbox, .e68-hw__map label').map((e) => e.textContent.trim()),
      notes: all('.e68-hw__note').map((e) => e.textContent),
      heads: all('.e68-hw__map-head').map((e) => e.textContent),
      units: all('.e68-hw__unit').map((e) => e.textContent),
      invalid: all('input[data-hw-address]').map((e) => e.getAttribute('aria-invalid') === 'true'),
    };
  });
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Screenshots of the panel: its upper part and, scrolled into view, the Memory Map group. */
async function shoot(page, base) {
  await page.locator('.e68-hw__devices').scrollIntoViewIfNeeded();
  await page.locator('.e68-hw').screenshot({ path: join(outDir, `${base}.png`) });
  await page.locator('.e68-hw__group--map').scrollIntoViewIfNeeded();
  await page.locator('.e68-hw__group--map').screenshot({ path: join(outDir, `${base}-map.png`) });
}

/** Part 1: the panel in the shell, with the shell's inert session. */
async function shellPass(browser, name) {
  const p = `${name}:`;
  const { context, page, errors } = await openApp(browser);
  await page.locator('.e68-modeswitch [data-mode="simulator"]').click();
  await page.evaluate(() => window.__easy68k.ctx.commands.run('sim.view.hardware'));
  const shown = await page.waitForSelector('.e68-hw', { timeout: 10000 }).then(
    () => true,
    () => false,
  );
  check(`${p} View > Hardware shows the Hardware panel`, shown);
  const panel = await readPanel(page);
  if (!panel) {
    await context.close();
    return;
  }
  check(`${p} 8 digits of 8 segments`, panel.segments === 64, `${panel.segments}`);
  check(`${p} 8 LEDs`, panel.leds === 8, `${panel.leds}`);
  check(
    `${p} bit labels 7..0`,
    same(panel.bitLabels, ['7', '6', '5', '4', '3', '2', '1', '0']),
    panel.bitLabels.join(),
  );
  check(`${p} 8 toggle switches, all off`, same(panel.switches, new Array(8).fill('false')), panel.switches.join());
  check(`${p} 8 push buttons`, panel.pushButtons === 8);
  check(
    `${p} four address fields 00 + E00000, E00010, E00012, E00014 labelled Address:`,
    same(panel.addresses, ['E00000', 'E00010', 'E00012', 'E00014']) &&
      same(panel.prefixes, ['00', '00', '00', '00']) &&
      same(panel.addressLabels, ['Address:', 'Address:', 'Address:', 'Address:']),
    `${panel.addresses.join()} ${panel.prefixes.join()} ${panel.addressLabels.join()}`,
  );
  check(
    `${p} IRQ buttons 7..1 and Reset`,
    same(panel.irq, ['7', '6', '5', '4', '3', '2', '1']) && same(panel.reset, ['enabled']),
    `${panel.irq.join()} ${panel.reset.join()}`,
  );
  check(`${p} 7 automatic check boxes`, panel.autoChecks.length === 7);
  check(`${p} Automatic label`, /^Automatic/.test(panel.autoLabel ?? ''), `${panel.autoLabel}`);
  check(
    `${p} interval field and level list`,
    panel.interval === '00001000' &&
      same(panel.levelOptions, ['1', '2', '3', '4', '5', '6', '7', '']) &&
      same(panel.units, ['mS', ' IRQ']),
    `${panel.interval} ${panel.levelOptions.join('|')} ${JSON.stringify(panel.units)}`,
  );
  check(
    `${p} groups " Interrupt ", Auto Interval, Reset, Memory Map`,
    same(panel.legends, [' Interrupt ', 'Auto Interval', 'Reset', 'Memory Map']),
    JSON.stringify(panel.legends),
  );
  check(
    `${p} Memory Map: 4 check boxes, 8 fields 000000, Start:/End:, the four notes`,
    panel.mapChecks === 4 &&
      same(panel.mapFields, new Array(8).fill('000000')) &&
      same(panel.heads, ['Start:', 'End:']) &&
      same(panel.notes, ['Writes are ignored', 'Bus error on write', 'Supervisor access', 'Bus error on access']),
    `${panel.mapChecks} ${panel.mapFields.join()} ${panel.notes.join('|')}`,
  );
  await shoot(page, `${name}-light-inert`);
  await scanPanel(page, `${name} light`);
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.theme.set', 'dark'));
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  await shoot(page, `${name}-dark-inert`);
  await scanPanel(page, `${name} dark`);
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

/** Installs the real engine, a real HardwareModel and the test controller into the page's session. */
async function installEngine(page) {
  return page.evaluate(async () => {
    const { createSimEngine } = await import('/src/engine/index.ts');
    const { createRecordingHost, assembleProgram } = await import('/src/engine/testing.ts');
    const { HardwareModel } = await import('/src/core/sim-host/hardware/model.ts');
    const { MiniController, TestClock, createTestTimers } = await import('/src/core/sim-host/hardware/testing.ts');
    const panels = await import('/src/state/panels.ts');
    const { ctx } = window.__easy68k;
    const clock = new TestClock();
    const timers = createTestTimers(clock);
    let engine = null;
    const controller = new MiniController(() => engine, 100);
    const model = new HardwareModel({
      post: controller.post,
      timers,
      showPanel: () => panels.showPanel(ctx, 'hardware', { focus: false }),
    });
    const recording = createRecordingHost({ hardware: model });
    engine = await createSimEngine(recording.host);
    // The cold start's settings (4.7.1 step 4).
    model.actions.setAddress(0, 0xe00000, false);
    model.actions.setAddress(1, 0xe00010, false);
    model.actions.setAddress(2, 0xe00012, false);
    model.actions.setAddress(3, 0xe00014, false);
    controller.deliver();
    // Close the panel, swap the parts, open it again: the panel mounts on the new session.
    panels.hidePanel(ctx, 'hardware');
    // ctx.sim itself is fixed; the inert session it holds is a plain object whose parts can be set.
    Object.assign(ctx.sim, {
      engine,
      hardware: model,
      controller: { ...ctx.sim.controller, post: controller.post },
    });
    if (ctx.sim.hardware !== model) throw new Error('the session parts could not be replaced');
    const loop = () => {
      try {
        clock.advance(16);
        timers.checkAll(clock.now());
        controller.tick(16000);
        window.__hw.frames++;
      } catch (error) {
        window.__hw.loopError = String(error?.stack ?? error);
        return;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    window.__hw = {
      frames: 0,
      loopError: null,
      engine,
      model,
      controller,
      async load(lines) {
        const program = await assembleProgram(lines);
        engine.load(program.s68, program.l68, { name: 'program.X68', kind: 'open' });
      },
      byte: (address) => engine.memory[address],
      show: () => panels.showPanel(ctx, 'hardware', { focus: false }),
      hide: () => panels.hidePanel(ctx, 'hardware'),
    };
    return true;
  });
}

const frames = (page, count = 4) =>
  page.evaluate(
    (n) =>
      new Promise((done) => {
        let left = n;
        const step = () => (--left <= 0 ? done(true) : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    count,
  );

const byte = (page, address) => page.evaluate((a) => window.__hw.byte(a), address);

/** Part 2: the panel on the real engine. */
async function enginePass(browser, name) {
  const p = `${name} (real engine):`;
  const { context, page, errors } = await openApp(browser);
  await page.locator('.e68-modeswitch [data-mode="simulator"]').click();
  await page.evaluate(() => window.__easy68k.ctx.commands.run('sim.view.hardware'));
  await page.waitForSelector('.e68-hw');
  await installEngine(page);
  await page.evaluate(() => window.__hw.show());
  await page.waitForSelector('.e68-hw');
  await frames(page);
  const loop = await page.evaluate(() => ({ frames: window.__hw.frames, error: window.__hw.loopError }));
  check(`${p} the test controller runs once per frame`, loop.frames > 0 && !loop.error, JSON.stringify(loop));
  check(
    `${p} the engine's form is visible after the panel was shown`,
    await page.evaluate(() => window.__hw.engine.hardware().visible),
  );

  await page.evaluate(() =>
    window.__hw.load([
      '        ORG     $1000',
      'START   MOVE.B  #$3F,$E00000',
      '        MOVE.B  #$A5,$E00010',
      'LOOP    BRA     LOOP',
      '        END     START',
    ]),
  );
  await frames(page);
  let panel = await readPanel(page);
  check(
    `${p} after a load all segments and LEDs are lit (memory $FF)`,
    panel.digits.every((d) => d === 'abcdefgh') && panel.ledsOn.length === 8,
    `${panel.digits.join(' ')} ${panel.ledsOn.join()}`,
  );
  await page.evaluate(() => window.__hw.controller.run());
  await frames(page, 6);
  panel = await readPanel(page);
  check(`${p} MOVE.B #$3F,$E00000 shows "0" on the leftmost digit`, panel.digits[0] === 'abcdef', panel.digits[0]);
  check(`${p} MOVE.B #$A5,$E00010 lights LEDs 7, 5, 2, 0`, same(panel.ledsOn, [7, 5, 2, 0]), panel.ledsOn.join());
  check(`${p} Run: Automatic Enabled`, panel.autoLabel === 'Automatic Enabled', `${panel.autoLabel}`);

  await page.evaluate(() => window.__hw.engine.writeBytes(0xe00000, [0x06]));
  await frames(page);
  panel = await readPanel(page);
  check(`${p} a write without a host call repaints the panel (writeBytes)`, panel.digits[0] === 'bc', panel.digits[0]);

  await page.locator('[data-switch="3"]').click();
  await frames(page);
  panel = await readPanel(page);
  check(
    `${p} clicking switch 3 sets bit 3 and draws it on`,
    (await byte(page, 0xe00012)) === 0x08 && panel.switches[4] === 'true',
    `${(await byte(page, 0xe00012)).toString(16)} ${panel.switches.join()}`,
  );

  const pb2 = page.locator('[data-pb="2"]');
  await pb2.hover();
  await page.mouse.down();
  await frames(page);
  const held = await byte(page, 0xe00014);
  await page.mouse.up();
  await frames(page);
  const released = await byte(page, 0xe00014);
  check(
    `${p} holding push button 2 reads $FB, releasing $FF`,
    held === 0xfb && released === 0xff,
    `${held} ${released}`,
  );

  await page.evaluate(() => {
    window.__lastPointer = null;
    document.addEventListener('pointerdown', (event) => (window.__lastPointer = event.pointerId), true);
  });
  await page.locator('[data-pb="4"]').hover();
  await page.mouse.down();
  await frames(page);
  const heldCancel = await byte(page, 0xe00014);
  await page.evaluate(() => {
    const button = document.querySelector('[data-pb="4"]');
    button.dispatchEvent(new PointerEvent('pointercancel', { pointerId: window.__lastPointer ?? 1, bubbles: true }));
  });
  await frames(page);
  const afterCancel = await byte(page, 0xe00014);
  await page.mouse.up();
  check(
    `${p} pointer cancel releases a held push button`,
    heldCancel === 0xef && afterCancel === 0xff,
    `${heldCancel} ${afterCancel}`,
  );

  // Conflict colouring: put the LEDs onto the switch byte.
  const led = page.locator('input[data-hw-address="1"]');
  await led.click();
  await page.keyboard.press('Home');
  await page.keyboard.type('E00012');
  await frames(page);
  panel = await readPanel(page);
  const colours = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('.e68-hw input[data-hw-address]'));
    const probe = document.createElement('span');
    probe.style.color = 'var(--c-danger)';
    document.querySelector('.e68-hw').appendChild(probe);
    const danger = getComputedStyle(probe).color;
    probe.remove();
    return { danger, fields: inputs.map((input) => getComputedStyle(input).color) };
  });
  check(
    `${p} typing E00012 into the LED address colours the LED and switch fields red`,
    panel.addresses[1] === 'E00012' &&
      same(panel.invalid, [false, true, true, false]) &&
      colours.fields[1] === colours.danger &&
      colours.fields[2] === colours.danger &&
      colours.fields[0] !== colours.danger,
    `${panel.addresses.join()} ${panel.invalid.join()} ${colours.fields.join(' / ')} danger ${colours.danger}`,
  );
  check(
    `${p} the engine took the address`,
    (await page.evaluate(() => window.__hw.engine.hardware().led)) === 0xe00012,
  );
  await shoot(page, `${name}-light-conflict`);
  await page.keyboard.press('Home');
  await page.keyboard.type('E00010');
  await frames(page);
  panel = await readPanel(page);
  check(`${p} fixing the address clears the colours`, same(panel.invalid, [false, false, false, false]));

  // Showing the panel: switch byte $00, pictures kept.
  await page.evaluate(() => window.__hw.hide());
  await frames(page);
  await page.evaluate(() => window.__hw.engine.writeBytes(0xe00012, [0x5a]));
  await page.evaluate(() => window.__hw.show());
  await page.waitForSelector('.e68-hw');
  await frames(page);
  panel = await readPanel(page);
  check(
    `${p} showing the panel zeroes the switch byte and keeps the switch pictures`,
    (await byte(page, 0xe00012)) === 0 && panel.switches[4] === 'true',
    `${await byte(page, 0xe00012)} ${panel.switches.join()}`,
  );

  // Auto interval through the panel: level 1 is selected, check box 1, interval 500.
  // The kit draws its own box over the input: click the label, as a user does.
  await page.locator('label:has(input[data-auto="1"])').click();
  const interval = page.locator('input[data-hw-interval]');
  await interval.click();
  await page.keyboard.press('Home');
  await page.keyboard.type('00000500');
  await frames(page);
  const auto = await page.evaluate(() => window.__hw.engine.hardware().auto[1]);
  check(
    `${p} check box 1 and interval 500 reach the engine; the timer runs during the run`,
    auto.checked && auto.intervalMs === 500 && auto.timerEnabled,
    JSON.stringify(auto),
  );

  await page.evaluate(() => window.__hw.controller.pause());
  await frames(page);
  panel = await readPanel(page);
  check(`${p} Pause: Automatic Disabled`, panel.autoLabel === 'Automatic Disabled', `${panel.autoLabel}`);

  await page.evaluate(() =>
    window.__hw.load(['        ORG     $1000', 'START   NOP', '        SIMHALT', '        END     START']),
  );
  await page.evaluate(() => window.__hw.controller.run());
  await frames(page, 6);
  panel = await readPanel(page);
  check(
    `${p} after SIMHALT the IRQ and Reset buttons are disabled`,
    panel.irq.every((entry) => entry.endsWith('d')) && same(panel.reset, ['disabled']),
    `${panel.irq.join()} ${panel.reset.join()}`,
  );
  await shoot(page, `${name}-light-halted`);
  await page.evaluate(() => window.__easy68k.ctx.commands.run('app.theme.set', 'dark'));
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  await shoot(page, `${name}-dark-halted`);
  await scanPanel(page, `${name} dark, real engine`);
  check(`${p} no console or page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function main() {
  const port = await freePort();
  const server = await createServer({
    configFile: join(appRoot, 'vite.config.ts'),
    root: appRoot,
    logLevel: 'warn',
    // No hot reload: fourteen other packages edit files while this runs, and a reload would
    // remount the panel in the middle of a check.
    server: { port, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  const address = server.httpServer?.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}/`;
  console.log(`Application: ${baseUrl}\nScreenshots: ${outDir}`);
  try {
    for (const name of browsers) {
      const browser = await BROWSERS[name].launch();
      try {
        console.log(`\n[${name}, shell]`);
        await shellPass(browser, name);
        console.log(`\n[${name}, real engine]`);
        if (enginesBuilt) await enginePass(browser, name);
        else if (process.env.EASY68K_REQUIRE_ENGINES === '1') {
          check(
            `${name}: engine/dist holds both engines (EASY68K_REQUIRE_ENGINES=1)`,
            false,
            'run npm run build:engines',
          );
        } else console.log('  skipped: engine/dist is missing (npm run build:engines)');
      } catch (error) {
        check(`${name}: the check ran to its end`, false, String(error?.stack ?? error));
        if (pageErrors.length) console.log(`        page errors: ${pageErrors.slice(0, 5).join(' | ')}`);
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed} of ${results.length} checks passed${failures ? `, ${failures} failed` : ''}.`);
  process.exit(failures ? 1 : 0);
}

await main();
