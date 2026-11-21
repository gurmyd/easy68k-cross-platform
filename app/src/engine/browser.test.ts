// The engine binding in real browsers (W4 acceptance, 9.1): Chromium and WebKit, headless, driven
// by Playwright from this Vitest file.
//
// What runs in the page is the production build of the binding (Vite, with the application's own
// configuration), served by a small static server that sends the Content Security Policy of 7.6 as
// a header, as the desktop app's protocol handler does; the page carries the same policy in a
// <meta> tag, as on GitHub Pages. A second suite uses the Vite development server.
//
// Each scenario below is one function that takes the binding (`E`) and plain data. It runs under
// Node with the binding imported here, and in the page, where the same source text is evaluated
// against `globalThis.easy68k`; the two results must be equal. A scenario may therefore use nothing
// but its two parameters: no import of this file, no helper defined outside it.
//
// The suite runs only when EASY68K_BROWSERS names the browsers: "chromium,webkit" (or "all"), one
// of them, or "none". Unset, it is skipped, so that a plain `npm test` starts no browser; `npm run
// check:engine-browsers` runs it for both. The browsers are those of `npx playwright install
// chromium webkit`. A browser that is not installed is skipped, unless EASY68K_REQUIRE_BROWSERS=1
// (then it is a failure). This file takes about twenty seconds; most of that is the 500 assemblies
// in WebKit. The memory figures of the 200-cycle and 500-assembly tests are written to
// build/reports/engine-binding-browsers.json.
//
// This is the one unit test that eslint.config.js lets import @playwright/test and vite. Do not
// run it with a coverage tool that rewrites the code (istanbul): the scenarios must stay
// self-contained source text.

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, webkit, type Browser, type BrowserType, type Page } from '@playwright/test';
import { build as viteBuild, createServer as createViteServer, type ViteDevServer } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as contracts from '../contracts';
import * as binding from './index';
import * as loader from './loader';
import * as testing from './testing';

// ---- what the page and Node share ---------------------------------------------------------------

/** The binding as a scenario sees it: `globalThis.easy68k` in the page, `nodeApi` here. */
type Harness = typeof binding & typeof loader & typeof testing & { contracts: typeof contracts };
const nodeApi: Harness = { ...binding, ...loader, ...testing, contracts };

type Scenario<I, O> = (E: Harness, input: I) => Promise<O>;

interface FixtureInput {
  name: string;
  s68: number[];
  l68: number[];
  caseNumber: number;
}

/** Loads both engines and says where their files came from and how they were loaded. */
const loadBoth: Scenario<
  null,
  { files: Record<string, string>; info: Record<string, loader.EngineLoadInfo>; ssp: number; s68: string }
> = async (E) => {
  const program = await E.assembleProgram(['        ORG     $1000', 'START   NOP', '        END     START']);
  const test = await E.createTestEngine();
  const ssp = test.engine.getRegister(E.contracts.Reg.SSP);
  test.release();
  const files: Record<string, string> = {};
  for (const name of ['asm', 'sim'] as const) {
    for (const [kind, url] of Object.entries(E.engineFiles(name))) files[`${name}.${kind}`] = url.href;
  }
  return {
    files,
    info: { asm: E.engineLoadInfo('asm'), sim: E.engineLoadInfo('sim') },
    ssp,
    s68: E.textOf(program.s68),
  };
};

/** Runs the engine's own fixtures to their halt; everything a program result consists of. */
const runFixtures: Scenario<FixtureInput[], Record<string, unknown>> = async (E, fixtures) => {
  const results: Record<string, unknown> = {};
  for (const fixture of fixtures) {
    const test = await E.createTestEngine();
    test.engine.load(new Uint8Array(fixture.s68), new Uint8Array(fixture.l68), { name: `${fixture.name}.S68` });
    test.engine.setRegister(E.contracts.Reg.D7, fixture.caseNumber);
    let report = E.runProgram(test.engine, { keys: ['W4\r'] });
    for (let stops = 0; report.reason === 'stopped' && !report.halted && stops < 5; stops++) {
      report = E.runProgram(test.engine); // a break directive in the listing: continue
    }
    const registers = test.engine.registers();
    results[fixture.name] = {
      report,
      registers: { ...registers, cycles: String(registers.cycles) },
      cyclesText: test.engine.cyclesText,
      // $4000: where the fixtures record what their own tests check (flags and values, per case)
      results: Array.from(test.engine.memory.subarray(0x4000, 0x4400)),
      listingLines: test.engine.listingLineCount,
      hostCalls: test.calls.map(E.describeCall),
    };
    test.release();
  }
  return results;
};

/** Assembles a source as the oracle test of asm.test.ts does. */
const assembleSmoke: Scenario<number[], { s68: string; l68: string; errors: number; fatal: string | null }> = async (
  E,
  source,
) => {
  const asm = await E.createAsmEngine();
  const result = await asm.assemble(
    'smoke.X68',
    new Map([['smoke.X68', new Uint8Array(source)]]),
    { ...E.TEST_ASM_OPTIONS, tabType: E.contracts.TabType.Assembly },
    new Date(2026, 10, 20, 19, 9, 32),
  );
  return {
    s68: E.textOf(result.sRecord ?? []),
    l68: E.textOf(result.listing ?? []),
    errors: result.errorCount,
    fatal: result.fatal,
  };
};

/** Assembles and runs the TRAP #15 tour: every host import of the .wasm is called. */
const runTour: Scenario<null, { s68: string; report: testing.RunReport; reached: string[][]; log: string[] }> = async (
  E,
) => {
  const program = await E.assembleProgram(E.trap15TourSource());
  const test = await E.createTestEngine({ files: E.createMemoryFiles() });
  const tour = E.runTrap15Tour(test, program);
  test.release();
  return { s68: E.textOf(program.s68), report: tour.report, reached: tour.reached, log: tour.log };
};

/**
 * Makes each engine throw and catch a C++ exception inside the .wasm. Both builds use WebAssembly
 * exception handling in its legacy encoding; this is the proof that the browser executes it.
 *
 * - Assembler: a structured-code terminator with an empty stack. The stand-in for the original's
 *   stack class throws, `asmStructure()` catches (engine/asm/PATCHES.md): "Invalid syntax".
 * - Simulator: a read-only range below the supervisor stack and an interrupt. The nested faults end
 *   at the recursion guard, which throws; `exec_inst()` catches and shows its error box
 *   (engine/sim/test/hardware.test.mjs).
 */
const throwInside: Scenario<
  { s68: number[]; l68: number[] },
  { asmMessages: string[]; alerts: string[]; status: number; afterwards: number; usable: boolean }
> = async (E, irqFixture) => {
  const asm = await E.createAsmEngine();
  const source = E.bytesOf('START   NOP\r\n        ENDI\r\n        END     START\r\n');
  const assembled = await asm.assemble('p.X68', new Map([['p.X68', source]]), E.TEST_ASM_OPTIONS, E.TEST_ASM_TIME);

  const { Reg, SimOption, MapKind } = E.contracts;
  const test = await E.createTestEngine();
  const engine = test.engine;
  engine.setOption(SimOption.Exceptions, true);
  engine.load(new Uint8Array(irqFixture.s68), new Uint8Array(irqFixture.l68), { name: 'irq.S68' });
  engine.setRegister(Reg.D7, 0);
  engine.cmdRunToAddress(0x2004);
  E.runProgram(engine, { start: false });
  engine.setMemoryMap(MapKind.Read, { enabled: true, start: 0x3000, end: 0x8000 - 1 });
  engine.irq(1);
  const status = engine.cmdTraceInto();
  const alerts = test.callsTo('alert').map(([title, text]) => `${E.textOf(title)}: ${E.textOf(text)}`);
  engine.dismissAlert();
  const afterwards = engine.run(0);
  // the engine is intact: take the map away and start over
  engine.setMemoryMap(MapKind.Read, { enabled: false });
  engine.rewind();
  const usable = engine.getRegister(Reg.PC) === 0x1000 && engine.cmdTraceInto() === E.contracts.RunStatus.Stopped;
  test.release();
  return { asmMessages: assembled.messages.map((message) => message.text), alerts, status, afterwards, usable };
};

/** What the binding says when an engine file is not on the server (engine/dist missing at build time). */
const missingFiles: Scenario<null, { wasm: string; loader: string; html: string }> = async (E) => {
  const message = (files: Partial<loader.EngineFiles>) =>
    E.loadEngineFrom('sim', { ...E.engineFiles('sim'), ...files }).then(
      () => 'loaded',
      (error: unknown) => `${(error as Error).name}: ${(error as Error).message}`,
    );
  return {
    wasm: await message({ wasm: new URL('assets/no-such.wasm', document.baseURI) }),
    loader: await message({ loader: new URL('assets/no-such-loader.mjs', document.baseURI) }),
    // a server that answers every unknown path with its start page
    html: await message({ wasm: new URL('index.html', document.baseURI) }),
  };
};

interface StressResult {
  cycles: number;
  cycleMs: number;
  /** Simulator instances created, and how many the browser had collected shortly after the loop. */
  simCreated: number;
  simCollectedAtEnd: number;
  assemblies: number;
  assemblyMs: number;
  /** The same for the assembler: one instance per assembly. */
  asmCreated: number;
  asmCollectedAtEnd: number;
  /** `performance.memory.usedJSHeapSize` before and after, where the browser has it (Chromium). */
  jsHeapBefore: number | null;
  jsHeapAfter: number | null;
  info: Record<string, loader.EngineLoadInfo>;
}

/**
 * 200 consecutive releaseSimEngine / createSimEngine cycles and 500 consecutive assemblies. Counts
 * the WebAssembly instances that were created and those the browser has collected again, and leaves
 * the counters in `globalThis.easy68kStress` for a later look.
 */
const stress: Scenario<{ cycles: number; assemblies: number; s68: number[] }, StressResult> = async (E, input) => {
  const counters = { simCreated: 0, simCollected: 0, asmCreated: 0, asmCollected: 0 };
  (globalThis as unknown as { easy68kStress: typeof counters }).easy68kStress = counters;
  // A FinalizationRegistry, not WeakRefs: a WeakRef keeps its target alive until the current task
  // ends, and in Chromium this whole loop is one task.
  const simMemories = new FinalizationRegistry<number>(() => counters.simCollected++);
  const asmInstances = new FinalizationRegistry<number>(() => counters.asmCollected++);
  const memory = (globalThis.performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  const jsHeapBefore = memory ? memory.usedJSHeapSize : null;
  // The registries report in later tasks: give them one before reading a counter.
  const pause = () => new Promise((resolve) => setTimeout(resolve, 50));

  // -- simulator: release, create, use
  let host = E.createRecordingHost();
  let engine = await E.createSimEngine(host.host);
  let started = Date.now();
  for (let cycle = 0; cycle < input.cycles; cycle++) {
    simMemories.register(engine.memory.buffer, cycle);
    counters.simCreated++;
    E.releaseSimEngine(engine);
    host = E.createRecordingHost();
    engine = await E.createSimEngine(host.host);
    // every tenth instance runs a program; every instance must be in start-up state
    if (engine.getRegister(E.contracts.Reg.SSP) !== 0x01000000)
      throw new Error(`cycle ${cycle}: not in start-up state`);
    if (engine.readByte(0x1000) !== 0xff) throw new Error(`cycle ${cycle}: memory is not fresh`);
    engine.writeBytes(0x1000, [cycle & 0xff]);
    if (cycle % 10 === 0) {
      engine.load(new Uint8Array(input.s68), null, { name: 'arith.S68' });
      const report = E.runProgram(engine);
      if (!report.halted) throw new Error(`cycle ${cycle}: the program did not halt`);
    }
  }
  const cycleMs = Date.now() - started;
  E.releaseSimEngine(engine);
  await pause();
  const simCollectedAtEnd = counters.simCollected;

  // -- assembler: every assembly is a new instance, created inside the engine's module
  const asm = await E.createAsmEngine();
  const files = new Map([
    [
      'p.X68',
      E.bytesOf('        ORG     $1000\r\nSTART   MOVEQ   #1,D0\r\n        SIMHALT\r\n        END     START\r\n'),
    ],
  ]);
  const instantiate = WebAssembly.instantiate;
  WebAssembly.instantiate = ((source: unknown, imports?: WebAssembly.Imports) =>
    (instantiate as (s: unknown, i?: WebAssembly.Imports) => Promise<unknown>)
      .call(WebAssembly, source, imports)
      .then((result) => {
        if (result instanceof WebAssembly.Instance) {
          asmInstances.register(result, counters.asmCreated);
          counters.asmCreated++;
        }
        return result;
      })) as typeof WebAssembly.instantiate;
  let first = '';
  started = Date.now();
  try {
    for (let i = 0; i < input.assemblies; i++) {
      const result = await asm.assemble('p.X68', files, E.TEST_ASM_OPTIONS, E.TEST_ASM_TIME);
      if (result.fatal !== null || result.errorCount !== 0)
        throw new Error(`assembly ${i}: ${result.fatal ?? 'errors'}`);
      const sRecord = E.textOf(result.sRecord ?? []);
      if (i === 0) first = sRecord;
      else if (sRecord !== first) throw new Error(`assembly ${i} gave another S-record`);
    }
  } finally {
    WebAssembly.instantiate = instantiate;
  }
  const assemblyMs = Date.now() - started;
  if (!first.includes('S804001000EB')) throw new Error('the S-record is not the expected one');
  await pause();

  return {
    cycles: input.cycles,
    cycleMs,
    simCreated: counters.simCreated,
    simCollectedAtEnd,
    assemblies: input.assemblies,
    assemblyMs,
    asmCreated: counters.asmCreated,
    asmCollectedAtEnd: counters.asmCollected,
    jsHeapBefore,
    jsHeapAfter: memory ? memory.usedJSHeapSize : null,
    info: { asm: E.engineLoadInfo('asm'), sim: E.engineLoadInfo('sim') },
  };
};

// ---- which browsers --------------------------------------------------------------------------------

const repo = (file: string) => fileURLToPath(new URL(`../../../${file}`, import.meta.url));
const enginesBuilt = ['asm68k.wasm', 'asm68k-loader.mjs', 'sim68k.wasm', 'sim68k-loader.mjs'].every((file) =>
  existsSync(repo(`engine/dist/${file}`)),
);
const required = process.env.EASY68K_REQUIRE_BROWSERS === '1';
/** Unset: the suite is not asked for (a plain `npm test`). */
const browsersSetting = process.env.EASY68K_BROWSERS;
const wanted = (browsersSetting ?? '')
  .split(',')
  .map((name) => name.trim())
  .flatMap((name) => (name === 'all' ? ['chromium', 'webkit'] : [name]))
  .filter((name, index, names) => name !== '' && name !== 'none' && names.indexOf(name) === index);
const NOT_ASKED =
  'not asked for: set EASY68K_BROWSERS=all (or chromium, webkit) or run "npm run check:engine-browsers"';
// A skipped test's title shows only with a verbose reporter, and Vitest drops the console output of
// a skipped file; a line written to stderr shows with any reporter.
if (browsersSetting === undefined) process.stderr.write(`src/engine/browser.test.ts skipped: ${NOT_ASKED}\n`);
const BROWSERS: Record<string, BrowserType> = { chromium, webkit };

/** Why a browser cannot be used here, or null. */
function unavailable(name: string): string | null {
  if (!enginesBuilt) return 'engine/dist is missing';
  const type = BROWSERS[name];
  if (!type) return `no browser "${name}" here (chromium or webkit)`;
  try {
    return existsSync(type.executablePath()) ? null : `not installed (npx playwright install ${name})`;
  } catch (error) {
    return `not available on this system (${error instanceof Error ? error.message : String(error)})`;
  }
}

// ---- the production build and its server ---------------------------------------------------------

const ENTRY = 'virtual:easy68k-engine-harness';
const here = (file: string) => fileURLToPath(new URL(file, import.meta.url)).replaceAll('\\', '/');
/** The module the page loads: the binding and its helpers as `globalThis.easy68k`. */
const ENTRY_SOURCE = `
import * as binding from ${JSON.stringify(here('./index.ts'))};
import * as loader from ${JSON.stringify(here('./loader.ts'))};
import * as testing from ${JSON.stringify(here('./testing.ts'))};
import * as contracts from ${JSON.stringify(here('../contracts/index.ts'))};
globalThis.easy68k = { ...binding, ...loader, ...testing, contracts };
`;

interface Built {
  dir: string;
  files: string[];
  origin: string;
  close(): Promise<void>;
}
let built: Promise<Built> | undefined;

/** Builds the harness with the application's Vite configuration and serves it; once per run. */
function productionBuild(): Promise<Built> {
  built ??= (async () => {
    const csp = (await import(/* @vite-ignore */ pathToFileURL(repo('tools/vite-csp-plugin.mjs')).href)) as {
      CONTENT_SECURITY_POLICY: string;
      META_TAG: string;
    };
    const dir = mkdtempSync(join(tmpdir(), 'easy68k-engine-'));
    await viteBuild({
      configFile: repo('app/vite.config.ts'),
      logLevel: 'error',
      plugins: [
        {
          name: 'easy68k-engine-harness',
          resolveId: (id) => (id === ENTRY ? `\0${ENTRY}` : undefined),
          load: (id) => (id === `\0${ENTRY}` ? ENTRY_SOURCE : undefined),
          // The page: the policy first, exactly as the application's index.html carries it.
          generateBundle(_options, bundle) {
            const entry = Object.values(bundle).find((chunk) => chunk.type === 'chunk' && chunk.isEntry);
            if (!entry) throw new Error('the harness build has no entry chunk');
            this.emitFile({
              type: 'asset',
              fileName: 'index.html',
              source: `<!doctype html>\n<html><head><meta charset="UTF-8" />\n${csp.META_TAG}\n</head><body><script type="module" src="./${entry.fileName}"></script></body></html>\n`,
            });
          },
        },
      ],
      build: {
        outDir: dir,
        emptyOutDir: true,
        sourcemap: false,
        copyPublicDir: false,
        rollupOptions: { input: ENTRY },
      },
    });

    // The content types of the desktop app's protocol handler (7.6). Under /plain/ the .wasm files
    // come as application/octet-stream, as from a server that does not know the type.
    const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };
    const server = createServer((request, response) => {
      const [, area, ...rest] = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname).split('/');
      const file = join(dir, ...rest);
      if ((area !== 'site' && area !== 'plain') || rest.includes('..') || !existsSync(file)) {
        response.writeHead(404).end('not found');
        return;
      }
      const wasmType = area === 'plain' ? 'application/octet-stream' : 'application/wasm';
      response.writeHead(200, {
        'Content-Type': extname(file) === '.wasm' ? wasmType : (types[extname(file)] ?? 'application/octet-stream'),
        'Content-Security-Policy': csp.CONTENT_SECURITY_POLICY,
      });
      response.end(readFileSync(file));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('the test server has no port');
    return {
      dir,
      files: readdirSync(join(dir, 'assets')).sort(),
      origin: `http://127.0.0.1:${address.port}`,
      close: async () => {
        await new Promise((resolve) => server.close(resolve));
        rmSync(dir, { recursive: true, force: true });
      },
    };
  })();
  return built;
}

/** A page of the harness, with everything that goes wrong in it collected in `problems`. */
async function openPage(browser: Browser, url: string): Promise<{ page: Page; problems: string[] }> {
  const page = await browser.newPage();
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning')
      problems.push(`console ${message.type()}: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('requestfailed', (request) => problems.push(`request failed: ${request.url()}`));
  await page.addInitScript({
    content: `globalThis.easy68kCspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) =>
        globalThis.easy68kCspViolations.push(event.violatedDirective + ' ' + event.blockedURI));`,
  });
  await page.goto(url);
  await page.waitForFunction('globalThis.easy68k !== undefined', undefined, { timeout: 30_000 });
  return { page, problems };
}

function inPage<I, O>(page: Page, scenario: Scenario<I, O>, input: I): Promise<O> {
  return page.evaluate<O>(`(${scenario.toString()})(globalThis.easy68k, ${JSON.stringify(input)})`);
}

/**
 * Memory of the processes this one started (the browser and its helpers), in bytes: resident set
 * size, on Windows the working set. Null when the system's process list cannot be read.
 */
function childProcessMemory(): Promise<number | null> {
  const windows = process.platform === 'win32';
  const command = windows ? 'powershell' : 'ps';
  const args = windows
    ? [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-CimInstance Win32_Process | ForEach-Object { '{0} {1} {2}' -f $_.ProcessId, $_.ParentProcessId, $_.WorkingSetSize }",
      ]
    : ['-A', '-o', 'pid=,ppid=,rss='];
  return new Promise((resolve) => {
    const lister = execFile(command, args, { encoding: 'utf8', timeout: 30_000 }, (error, list) => {
      if (error) return resolve(null);
      const children = new Map<number, { pid: number; bytes: number }[]>();
      for (const line of list.split('\n')) {
        const [pid, parent, size] = line.trim().split(/\s+/).map(Number);
        if (pid === undefined || parent === undefined || size === undefined || Number.isNaN(size)) continue;
        children.set(parent, [...(children.get(parent) ?? []), { pid, bytes: size * (windows ? 1 : 1024) }]);
      }
      let total = 0;
      // everything below this process, except the program that made the list
      const queue = (children.get(process.pid) ?? []).filter((child) => child.pid !== lister.pid);
      for (let next = queue.shift(); next; next = queue.shift()) {
        total += next.bytes;
        queue.push(...(children.get(next.pid) ?? []));
      }
      resolve(total);
    });
  });
}

const MiB = 1024 * 1024;
const mib = (bytes: number | null) => (bytes === null ? null : Math.round((bytes / MiB) * 10) / 10);
const memoryReport: Record<string, unknown> = {};

// ---- inputs --------------------------------------------------------------------------------------

const fixtureDir = repo('engine/sim/test/fixtures');
const bytes = (file: string) => Array.from(readFileSync(file));
/** The engine's fixtures. Case 2 of irq halts by itself; case 0 of the others is their first case. */
const fixtures = (): FixtureInput[] =>
  readdirSync(fixtureDir)
    .filter((file) => file.endsWith('.S68'))
    .sort()
    .map((file) => {
      const name = file.slice(0, -4);
      return {
        name,
        s68: bytes(`${fixtureDir}/${name}.S68`),
        l68: bytes(`${fixtureDir}/${name}.L68`),
        caseNumber: name === 'irq' ? 2 : 0,
      };
    });

// ---- the tests -----------------------------------------------------------------------------------

describe('browsers for the engine binding', () => {
  if (browsersSetting === undefined) {
    it.skip(NOT_ASKED, () => {});
  } else if (wanted.length === 0) {
    it('none was asked for (EASY68K_BROWSERS)', () => {
      expect(wanted).toEqual([]);
    });
  }
  for (const name of wanted) {
    const reason = unavailable(name);
    it.skipIf(reason !== null && !required)(`${name} is available`, () => {
      expect(reason, `${name}: ${reason}`).toBeNull();
    });
  }
});

afterAll(async () => {
  if (Object.keys(memoryReport).length > 0) {
    const file = repo('build/reports/engine-binding-browsers.json');
    mkdirSync(repo('build/reports'), { recursive: true });
    writeFileSync(file, `${JSON.stringify(memoryReport, null, 2)}\n`);
  }
  if (built) await (await built).close();
}, 60_000);

for (const name of wanted) {
  describe.skipIf(unavailable(name) !== null)(`the production build in ${name}`, () => {
    let site: Built;
    let browser: Browser;
    let page: Page;
    let problems: string[];
    let memoryAtStart: Promise<number | null>;

    beforeAll(async () => {
      site = await productionBuild();
      const type = BROWSERS[name] as BrowserType;
      // --enable-precise-memory-info: performance.memory without its coarse rounding (Chromium).
      browser = await type.launch({
        headless: true,
        args: name === 'chromium' ? ['--enable-precise-memory-info'] : [],
      });
      ({ page, problems } = await openPage(browser, `${site.origin}/site/index.html`));
      memoryAtStart = childProcessMemory(); // read while the first tests run; it takes seconds on Windows
    }, 120_000);

    // Closing a browser can take over 10 s (the default hook limit) on a busy machine.
    afterAll(async () => {
      await browser?.close();
    }, 60_000);

    it('the build holds the six engine files as hashed assets, loaded by URL at run time', () => {
      const engineFiles = site.files
        .filter((file) => /^(asm|sim)68k/.test(file))
        .map((file) => file.replace(/-[\w-]{8}\.(mjs|wasm)$/, '-HASH.$1'))
        .sort();
      expect(engineFiles).toEqual([
        'asm68k-HASH.mjs',
        'asm68k-HASH.wasm',
        'asm68k-loader-HASH.mjs',
        'sim68k-HASH.mjs',
        'sim68k-HASH.wasm',
        'sim68k-loader-HASH.mjs',
      ]);
    });

    it('both engines load under the Content Security Policy, each .wasm compiled once', async () => {
      const first = await inPage(page, loadBoth, null);
      const again = await inPage(page, loadBoth, null);
      const node = await loadBoth(nodeApi, null);
      // the same engines as under Node: the same S-record, the same start-up state
      expect(first.s68).toBe(node.s68);
      expect(first.ssp).toBe(0x01000000);
      // every file comes from the assets folder next to the page
      expect(Object.keys(first.files).sort()).toEqual([
        'asm.api',
        'asm.loader',
        'asm.wasm',
        'sim.api',
        'sim.loader',
        'sim.wasm',
      ]);
      for (const url of Object.values(first.files))
        expect(url).toMatch(new RegExp(`^${site.origin}/site/assets/(asm|sim)68k`));
      expect(first.info.asm?.compilations).toBe(1);
      expect(first.info.sim?.compilations).toBe(1);
      expect(again.info.asm?.compilations).toBe(1);
      expect(again.info.sim?.compilations).toBe(1);
      expect(again.info.sim?.instances).toBe(2);
      expect(await page.evaluate('globalThis.easy68kCspViolations')).toEqual([]);
    }, 60_000);

    it("the engine's own fixtures run to their halt, with the results they have under Node", async () => {
      const input = fixtures();
      expect(input.length).toBeGreaterThanOrEqual(11);
      const inBrowser = await inPage(page, runFixtures, input);
      const underNode = await runFixtures(nodeApi, input);
      for (const fixture of input) {
        expect(inBrowser[fixture.name], fixture.name).toEqual(underNode[fixture.name]);
        expect(inBrowser[fixture.name], fixture.name).toMatchObject({ report: { reason: 'stopped', halted: true } });
      }
    }, 120_000);

    it("smoke.X68 assembles to the bytes it has under Node (which are the oracle's, asm.test.ts)", async () => {
      const source = bytes(repo('tests/oracle/asm-cli/smoke-test/smoke.X68'));
      const inBrowser = await inPage(page, assembleSmoke, source);
      expect(inBrowser).toEqual(await assembleSmoke(nodeApi, source));
      expect(inBrowser).toMatchObject({ errors: 0, fatal: null });
      expect(inBrowser.s68.length).toBe(706);
    }, 60_000);

    it('the TRAP #15 tour makes the same host calls, with the same arguments, as under Node', async () => {
      const inBrowser = await inPage(page, runTour, null);
      const underNode = await runTour(nodeApi, null);
      expect(inBrowser.s68).toBe(underNode.s68);
      expect(inBrowser.log).toEqual(underNode.log);
      expect(inBrowser.reached).toEqual(underNode.reached);
      expect(inBrowser.report).toEqual(underNode.report);
      // every task reached what the specs say (trap15.test.ts shows the table step by step)
      const sets = (lists: readonly (readonly string[])[]) => lists.map((list) => [...new Set(list)].sort());
      expect(sets(inBrowser.reached)).toEqual(sets(testing.TRAP15_TOUR.map((step) => step.reaches)));
      expect(new Set(inBrowser.reached.flat()).size).toBe(80);
    }, 60_000);

    it('C++ exceptions are thrown and caught inside both engines (legacy WebAssembly exception handling)', async () => {
      const [irq] = fixtures().filter((entry) => entry.name === 'irq');
      if (!irq) throw new Error('the irq fixture is missing');
      const inBrowser = await inPage(page, throwInside, { s68: irq.s68, l68: irq.l68 });
      expect(inBrowser).toEqual(await throwInside(nodeApi, { s68: irq.s68, l68: irq.l68 }));
      expect(inBrowser.asmMessages).toEqual(['ERROR: Invalid syntax']);
      expect(inBrowser.alerts.length).toBe(1);
      expect(inBrowser.alerts[0]).toMatch(
        /^Error: ERROR: An exception occurred in routine 'exec_inst'\.\nPC=[0-9A-F]{8} {2}Code=[0-9A-F]{4}$/,
      );
      expect(inBrowser).toMatchObject({
        status: contracts.RunStatus.WaitAlert,
        afterwards: contracts.RunStatus.Stopped,
        usable: true,
      });
    }, 60_000);

    it('200 consecutive releaseSimEngine / createSimEngine cycles and 500 consecutive assemblies succeed', async () => {
      const input = { cycles: 200, assemblies: 500, s68: bytes(`${fixtureDir}/arith.S68`) };
      const processStart = await memoryAtStart;
      const result = await inPage(page, stress, input);
      // Ask the browser to collect, then look again.
      await page.requestGC();
      await page.evaluate('new Promise((resolve) => setTimeout(resolve, 200))');
      await page.requestGC();
      const after = await page.evaluate<{ simCollected: number; asmCollected: number }>('globalThis.easy68kStress');
      const processEnd = await childProcessMemory();

      expect(result).toMatchObject({ cycles: 200, simCreated: 200, assemblies: 500, asmCreated: 500 });
      expect(result.info.sim?.compilations).toBe(1);
      expect(result.info.asm?.compilations).toBe(1);
      // Released instances are collectable: after a collection most are gone. (Exact numbers are
      // the browser's business; none at all would be a leak in the binding.)
      expect(after.simCollected).toBeGreaterThanOrEqual(100);
      expect(after.asmCollected).toBeGreaterThanOrEqual(250);

      memoryReport[name] = {
        date: new Date().toISOString(),
        simulator: {
          cycles: result.cycles,
          milliseconds: result.cycleMs,
          instancesCreated: result.simCreated,
          instancesCollectedAtEndOfLoop: result.simCollectedAtEnd,
          instancesCollectedAfterGcRequest: after.simCollected,
          // each instance has 64 MiB of WebAssembly memory; one instance exists before the loop
          wasmMemoryNotYetCollectedMiB: {
            start: 64,
            endOfLoop: (result.simCreated + 1 - result.simCollectedAtEnd) * 64,
            afterGcRequest: (result.simCreated + 1 - after.simCollected) * 64,
          },
        },
        assembler: {
          assemblies: result.assemblies,
          milliseconds: result.assemblyMs,
          instancesCreated: result.asmCreated,
          instancesCollectedAtEndOfLoop: result.asmCollectedAtEnd,
          instancesCollectedAfterGcRequest: after.asmCollected,
        },
        jsHeapMiB: { start: mib(result.jsHeapBefore), end: mib(result.jsHeapAfter) },
        browserProcessesMiB: { start: mib(processStart), end: mib(processEnd) },
        compilations: { sim: result.info.sim?.compilations, asm: result.info.asm?.compilations },
      };
      console.info(`[engine binding] ${name}: ${JSON.stringify(memoryReport[name])}`);
    }, 300_000);

    it('the engines also load when the server calls a .wasm file application/octet-stream', async () => {
      const plain = await openPage(browser, `${site.origin}/plain/index.html`);
      const result = await inPage(plain.page, loadBoth, null);
      expect(result.ssp).toBe(0x01000000);
      expect(result.info.sim?.compilations).toBe(1);
      expect(Object.values(result.files).every((url) => url.startsWith(`${site.origin}/plain/assets/`))).toBe(true);
      expect(plain.problems).toEqual([]);
      await plain.page.close();
    }, 60_000);

    it('an engine file that is not on the server is reported with what to do', async () => {
      const other = await openPage(browser, `${site.origin}/site/index.html`);
      const messages = await inPage(other.page, missingFiles, null);
      const advice = 'run "npm run build:engines" (needs Emscripten) or "npm run fetch:engines"';
      expect(messages.wasm).toMatch(
        /^EngineLoadError: The simulator engine could not be loaded: .*no-such\.wasm: HTTP 404/,
      );
      expect(messages.wasm).toContain(advice);
      expect(messages.loader).toMatch(/^EngineLoadError: The simulator engine could not be loaded: /);
      expect(messages.loader).toContain(advice);
      expect(messages.html).toMatch(/index\.html is not a WebAssembly file/);
      await other.page.close();
    }, 60_000);

    it('nothing was blocked by the policy, failed to load or was logged as an error', async () => {
      expect(await page.evaluate('globalThis.easy68kCspViolations')).toEqual([]);
      expect(problems).toEqual([]);
    });
  });
}

describe.skipIf(wanted.every((name) => unavailable(name) !== null))('the Vite development server', () => {
  let server: ViteDevServer;
  let url: string;
  let cacheDir: string;

  beforeAll(async () => {
    cacheDir = mkdtempSync(join(tmpdir(), 'easy68k-engine-dev-'));
    const page = `<!doctype html><html><head><meta charset="UTF-8" /></head><body><script type="module">
import * as binding from '/src/engine/index.ts';
import * as loader from '/src/engine/loader.ts';
import * as testing from '/src/engine/testing.ts';
import * as contracts from '/src/contracts/index.ts';
globalThis.easy68k = { ...binding, ...loader, ...testing, contracts };
</script></body></html>`;
    server = await createViteServer({
      configFile: repo('app/vite.config.ts'),
      logLevel: 'error',
      // its own cache folder: a development server someone else is running keeps its own
      cacheDir,
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null },
      plugins: [
        {
          name: 'easy68k-engine-harness',
          configureServer(dev) {
            dev.middlewares.use('/engine-harness.html', (_request, response) => {
              response.setHeader('Content-Type', 'text/html');
              response.end(page);
            });
          },
        },
      ],
    });
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('the development server has no port');
    url = `http://127.0.0.1:${address.port}/engine-harness.html`;
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    if (cacheDir) rmSync(cacheDir, { recursive: true, force: true });
  }, 60_000);

  for (const name of wanted) {
    it.skipIf(unavailable(name) !== null)(
      `${name}: both engines load from /@fs/ URLs and run a program`,
      async () => {
        const type = BROWSERS[name] as BrowserType;
        const browser = await type.launch({ headless: true });
        try {
          const { page, problems } = await openPage(browser, url);
          const result = await inPage(page, loadBoth, null);
          expect(result.s68).toBe((await loadBoth(nodeApi, null)).s68);
          expect(result.ssp).toBe(0x01000000);
          expect(result.files['sim.wasm']).toMatch(/\/@fs\/.*\/engine\/dist\/sim68k\.wasm$/);
          expect(result.files['asm.api']).toMatch(/\/@fs\/.*\/engine\/asm\/asm68k\.mjs$/);
          const [fixture] = fixtures().filter((entry) => entry.name === 'arith');
          const outcome = await inPage(page, runFixtures, fixture ? [fixture] : []);
          expect(outcome.arith).toMatchObject({ report: { reason: 'stopped', halted: true } });
          expect(problems).toEqual([]);
        } finally {
          await browser.close();
        }
      },
      120_000,
    );
  }
});
