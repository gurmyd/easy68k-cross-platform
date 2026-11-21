// Check 2 of ARCHITECTURE.md 6.7: the packaged app starts; the page loads without a Content
// Security Policy violation; both engines start; the window title is the one of 1.3.3;
// window.easy68kDesktop has exactly the documented functions and the page has no require and no
// process. Also: the packaged app ignores the development and test variables
// (docs/porting/errata/DV2.md entry 15).
//
// Owner: DV3.

import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { DESKTOP_BRIDGE_KEYS } from '../../../app/src/platform/desktop';
import { cspViolationLines } from './facts';
import {
  APP_PAGE,
  IS_MAC,
  launchPackaged,
  nativeWindows,
  NOT_MAC,
  rootVersion,
  waitFor,
  waitForApplication,
  type RunningApp,
} from './harness';

test.describe.configure({ mode: 'serial' });

let running: RunningApp;
let startupErrors: string[] = [];

test.beforeAll(async () => {
  test.skip(!IS_MAC, NOT_MAC);
  test.setTimeout(300_000);
  running = await launchPackaged({
    name: 'launch',
    // A packaged app must ignore all three (security.ts developmentOverrides): another folder to
    // serve, another page to load, hidden test windows with test hooks.
    env: {
      EASY68K_APP_DIST: mkdtempSync(join(tmpdir(), 'easy68k-empty-dist-')),
      EASY68K_DEV_SERVER_URL: 'http://127.0.0.1:9/',
      EASY68K_DESKTOP_TEST_WINDOWS: 'hidden',
    },
  });
  await waitForApplication(running.page);
  await running.page.waitForTimeout(2000);
  startupErrors = [...running.errors];
  await running.screenshot('started');
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  await running?.close();
});

test('the window shows app://easy68k/index.html and the development variables are ignored', () => {
  expect(running.page.url()).toBe(APP_PAGE);
  const windows = nativeWindows(running.pid);
  console.log(`windows: ${JSON.stringify(windows)}`);
  // EASY68K_DESKTOP_TEST_WINDOWS=hidden would have kept it off the screen.
  expect(windows.length).toBeGreaterThan(0);
  expect(windows.some((window) => !window.minimised)).toBe(true);
});

test('the page loads without a Content Security Policy violation', async () => {
  // The first load, before the harness attached: Chromium's log (--enable-logging) carries the
  // console messages of the page, a violation among them.
  expect(cspViolationLines(running.log()), 'violations in the log of the first load').toEqual([]);
  expect(startupErrors, 'console errors after the harness attached').toEqual([]);

  // A second load watched from its first script on: every violation event and console error.
  const page = running.page;
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __e68Violations: string[] }).__e68Violations = seen;
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  const before = running.errors.length;
  await page.reload({ waitUntil: 'load', timeout: 90_000 });
  await waitForApplication(page);
  await page.waitForTimeout(3000);
  const violations = await page.evaluate(() => (window as unknown as { __e68Violations?: string[] }).__e68Violations);
  expect(violations, 'securitypolicyviolation events during a load').toEqual([]);
  expect(running.errors.slice(before), 'console errors during a load').toEqual([]);

  // The policy is in force: an inline script is refused (7.6: scripts stay strict).
  const blocked = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        document.addEventListener('securitypolicyviolation', () => resolve(true), { once: true });
        const script = document.createElement('script');
        script.textContent = 'window.__e68Inline = 1';
        document.head.append(script);
        setTimeout(() => resolve((window as unknown as { __e68Inline?: number }).__e68Inline === undefined), 1000);
      }),
  );
  expect(blocked).toBe(true);
});

test('both engines start', async () => {
  const chunk = readdirSync(join(running.packaged.appDist, 'assets')).find((name) => /^engine-[\w-]+\.js$/.test(name));
  expect(chunk, 'the engine binding chunk (app/src/engine/index.ts) in the bundle').toBeTruthy();
  const result = await running.page.evaluate(async (chunkName) => {
    // The page's own engine binding, loaded the way the application loads it.
    const binding = (await import(`./assets/${chunkName}`)) as {
      createAsmEngine(): Promise<{
        assemble(
          main: string,
          files: Map<string, Uint8Array>,
          options: Record<string, unknown>,
          date: Date,
        ): Promise<{
          errorCount: number;
          sRecord: Uint8Array | null;
          listing: Uint8Array | null;
          fatal: string | null;
        }>;
      }>;
      createSimEngine(host: object): Promise<{
        load(s68: Uint8Array, l68?: Uint8Array | null, options?: object): void;
        readWord(address: number): number;
        readLong(address: number): number;
      }>;
      releaseSimEngine(engine: object): void;
    };
    const source = '\tORG\t$1000\r\nSTART\tMOVE.L\t#$12345678,D0\r\n\tSIMHALT\r\n\tEND\tSTART\r\n';
    const asm = await binding.createAsmEngine();
    const assembled = await asm.assemble(
      'prog.X68',
      new Map([['prog.X68', Uint8Array.from(source, (c) => c.charCodeAt(0))]]),
      {
        generateListing: true,
        generateSRecord: true,
        constantsExpanded: false,
        bitFieldInstructions: false,
        crossReference: false,
        macrosExpanded: false,
        structuredExpanded: false,
        showWarnings: true,
        tabType: 0,
        tabSize: 8,
      },
      new Date(2026, 0, 1),
    );
    // A host whose every method answers nothing: the engine then uses its own defaults.
    const host = new Proxy({}, { get: () => () => undefined });
    const sim = await binding.createSimEngine(host);
    let opcode = -1;
    let operand = -1;
    if (assembled.sRecord) {
      sim.load(assembled.sRecord, assembled.listing, { name: 'prog', kind: 'open' });
      opcode = sim.readWord(0x1000);
      operand = sim.readLong(0x1002);
    }
    binding.releaseSimEngine(sim);
    return {
      fatal: assembled.fatal,
      errors: assembled.errorCount,
      hasSRecord: assembled.sRecord !== null,
      opcode,
      operand,
    };
  }, chunk as string);
  expect(result.fatal).toBeNull();
  expect(result.errors).toBe(0);
  expect(result.hasSRecord).toBe(true);
  expect(result.opcode).toBe(0x203c); // MOVE.L #imm,D0
  expect(result.operand).toBe(0x12345678);
});

test('the window title is the one of 1.3.3', async () => {
  const expected = `EASy68K Editor/Assembler v5.16.01 - unofficial port ${rootVersion()}`;
  const titles = await waitFor(`a window titled "${expected}"`, 30_000, () => {
    const names = nativeWindows(running.pid).map((window) => window.name);
    return names.includes(expected) ? names : null;
  });
  console.log(`window titles: ${JSON.stringify(titles)}`);
});

test('window.easy68kDesktop has exactly the documented functions; no require, no process', async () => {
  const facts = await running.page.evaluate(() => ({
    require: typeof (window as unknown as Record<string, unknown>)['require'],
    process: typeof (window as unknown as Record<string, unknown>)['process'],
    module: typeof (window as unknown as Record<string, unknown>)['module'],
    keys: Object.keys(window.easy68kDesktop ?? {}).sort(),
    devices: Object.keys(window.easy68kDesktop?.devices ?? {}).sort(),
  }));
  expect(facts.require).toBe('undefined');
  expect(facts.process).toBe('undefined');
  expect(facts.module).toBe('undefined');
  expect(facts.keys).toEqual([...DESKTOP_BRIDGE_KEYS].sort());
  expect(facts.devices).toEqual(['on', 'request']);
});
