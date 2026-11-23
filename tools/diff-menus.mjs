#!/usr/bin/env node
// `node tools/diff-menus.mjs`: compares the resolved menus of `main` with those of this working
// copy (the branch `plus`), as ARCHITECTURE-PLUS P1.1 and P6.4 ask.
//
//     node tools/diff-menus.mjs [--main <git ref>] [--json <file>]
//
// --main defaults to `git merge-base HEAD main`, the last commit of main that plus holds. The
// ref's app/src is taken with `git archive` (read only) into build/diff-menus/<ref>/ and loaded,
// like this working copy's app/src, through Vite's module loader, so both sides run their own
// commands/menus.ts, native-menu.ts, specs.ts and tables.
//
// For every mode (editor, simulator, easybin), every key map (windows, mac, linux), the browser
// and the desktop app, with and without open documents, it resolves the menu bar (resolveMenus)
// and the native menu (buildNativeMenu), and requires:
//   - the same menus, in the same order, with the same captions (access keys included);
//   - in every menu and submenu, main's items first, unchanged (caption, access key, kind, command,
//     argument, shortcut); anything plus adds comes after them and begins with a separator. As the
//     Editor's document list is the end of main's Window menu, its additions follow that list;
//   - in the native Window menu the system's own items (Minimize, Zoom) stay last, so the rule is
//     applied to what comes before them;
//   - no entry of commands/tables/keys.ts (KEYS, and the lists beside it) changed or removed; added
//     entries are listed, and an added chord may not be a chord main already gives a command.
// It prints every difference, then "N of M comparisons passed", and exits 1 on any failure.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(repo, 'package.json'));

const args = process.argv.slice(2);
function option(name) {
  const at = args.indexOf(name);
  if (at === -1) return null;
  const value = args[at + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`diff-menus: ${name} needs a value`);
    process.exit(2);
  }
  return value;
}
for (const arg of args) {
  if (arg.startsWith('--') && !['--main', '--json'].includes(arg)) {
    console.error(`diff-menus: unknown argument ${arg}`);
    process.exit(2);
  }
}

function git(...gitArgs) {
  const result = spawnSync('git', gitArgs, { cwd: repo, encoding: 'buffer', maxBuffer: 1 << 28 });
  if (result.status !== 0) {
    console.error(`diff-menus: git ${gitArgs.join(' ')} failed: ${result.stderr.toString()}`);
    process.exit(2);
  }
  return result.stdout;
}

const mainRef = option('--main') ?? git('merge-base', 'HEAD', 'main').toString().trim();
const mainCommit = git('rev-parse', '--short', `${mainRef}^{commit}`).toString().trim();
const jsonOut = option('--json');

// main's app/src, below build/ so that its bare imports resolve from this working copy's node_modules.
const mainRoot = join(repo, 'build', 'diff-menus', mainCommit);
rmSync(mainRoot, { recursive: true, force: true });
mkdirSync(mainRoot, { recursive: true });
const tarFile = join(mainRoot, 'src.tar');
writeFileSync(tarFile, git('archive', '--format=tar', mainCommit, 'app/src'));
const untar = spawnSync('tar', ['-xf', 'src.tar'], { cwd: mainRoot, encoding: 'utf8' });
if (untar.status !== 0) {
  console.error(`diff-menus: tar failed: ${untar.stderr}`);
  process.exit(2);
}
rmSync(tarFile);

const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);

async function loadSide(srcRoot) {
  const server = await createServer({
    root: srcRoot,
    configFile: false,
    logLevel: 'error',
    // No HMR web socket: it would take Vite's fixed port 24678, which other tools may hold.
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const load = (path) => server.ssrLoadModule(join(srcRoot, path).replaceAll('\\', '/'));
  const side = {
    menus: await load('commands/menus.ts'),
    native: await load('commands/native-menu.ts'),
    keys: await load('commands/tables/keys.ts'),
    store: await load('state/store.ts'),
    defaults: await load('core/settings/defaults.ts'),
  };
  return { side, close: () => server.close() };
}

const plusSide = await loadSide(join(repo, 'app', 'src'));
const mainSide = await loadSide(join(mainRoot, 'app', 'src'));

const MODES = ['editor', 'simulator', 'easybin'];
const OSES = ['windows', 'mac', 'linux'];

/** The state of a fresh window, optionally with three documents open (the second active). */
function stateOf(side, documents) {
  const state = side.store.initialAppState(side.defaults.defaultSettings());
  if (!documents) return state;
  const doc = (id, name) => ({
    id,
    path: null,
    name,
    kind: 'source',
    hasName: false,
    tabType: 1,
    tabSize: 4,
    fontName: 'Courier New',
    fontSize: 10,
    insertMode: true,
    modified: false,
    revision: 0,
  });
  return {
    ...state,
    documents: {
      ...state.documents,
      items: [doc('d1', 'one.X68'), doc('d2', 'R&D.X68'), doc('d3', 'three.X68')],
      activeId: 'd2',
    },
  };
}

/** Everything enabled, nothing checked: the same registry for both sides. */
const commands = { isEnabled: () => true, isChecked: () => false };

/** A node as compared: what a person sees of it and what it does. */
function key(node) {
  if (node.type === 'separator') return 'separator';
  if (node.type === 'submenu' || node.items) {
    return `submenu ${JSON.stringify(node.caption ?? node.label)}${node.role ? ` role=${node.role}` : ''}`;
  }
  if (node.role && node.id === undefined) return `role=${node.role} ${JSON.stringify(node.label ?? '')}`;
  return [
    JSON.stringify(node.caption ?? node.label),
    node.id,
    node.kind ?? node.type,
    node.arg === undefined ? '' : `arg=${JSON.stringify(node.arg)}`,
    `shortcut=${node.shortcut ?? node.accelerator ?? '-'}`,
  ].join(' ');
}

const SYSTEM_ROLES = new Set(['minimize', 'zoom']);

let comparisons = 0;
const failures = [];
const additions = new Map();

/**
 * main's list must be a prefix of plus's list (recursively for submenus), and what plus adds must
 * begin with a separator.
 */
function compareList(where, mainItems, plusItems, native) {
  let mainList = mainItems;
  let plusList = plusItems;
  if (native) {
    // The native Window menu ends with the system's items, after a separator.
    const tail = (list) => {
      let at = list.length;
      while (at > 0 && list[at - 1].role && SYSTEM_ROLES.has(list[at - 1].role)) at -= 1;
      if (at < list.length && at > 0 && list[at - 1].type === 'separator') at -= 1;
      return at;
    };
    const mainTail = tail(mainList);
    const plusTail = tail(plusList);
    const a = mainList.slice(mainTail).map(key).join(' | ');
    const b = plusList.slice(plusTail).map(key).join(' | ');
    comparisons += 1;
    if (a !== b) failures.push(`${where}: the system's items at the end differ: main [${a}] plus [${b}]`);
    mainList = mainList.slice(0, mainTail);
    plusList = plusList.slice(0, plusTail);
  }
  comparisons += 1;
  for (let i = 0; i < mainList.length; i += 1) {
    const m = mainList[i];
    const p = plusList[i];
    if (p === undefined) {
      failures.push(`${where}: item ${i + 1} of main (${key(m)}) is missing`);
      return;
    }
    if (key(m) !== key(p)) {
      failures.push(`${where}: item ${i + 1} is ${key(p)} on plus, ${key(m)} on main`);
      return;
    }
    if (m.items) compareList(`${where} > ${m.caption ?? m.label}`, m.items, p.items ?? [], false);
  }
  const added = plusList.slice(mainList.length);
  if (added.length === 0) return;
  if (added[0].type !== 'separator') {
    failures.push(`${where}: plus adds ${key(added[0])} without a separator after main's items`);
    return;
  }
  const text = added.map(key).join(' | ');
  // Listed once per mode and menu; the comparison itself ran for every key map and state.
  additions.set(where.replace(/\[(\w+) [^\]]*\]/, '[$1]'), text);
}

function compareBars(where, mainBar, plusBar, native) {
  comparisons += 1;
  const a = mainBar.map((menu) => key(menu)).join(' | ');
  const b = plusBar.map((menu) => key(menu)).join(' | ');
  if (a !== b) {
    failures.push(`${where}: the menu bar differs: main [${a}] plus [${b}]`);
    return;
  }
  for (let i = 0; i < mainBar.length; i += 1) {
    const caption = mainBar[i].caption ?? mainBar[i].label;
    compareList(`${where} ${caption}`, mainBar[i].items, plusBar[i].items, native && mainBar[i].role === 'window');
  }
}

for (const mode of MODES) {
  for (const os of OSES) {
    for (const desktop of [false, true]) {
      for (const documents of [false, true]) {
        const tag = `[${mode} ${os}${desktop ? ' desktop' : ' browser'}${documents ? ', 3 documents' : ''}]`;
        const envOf = (side) => ({ os, desktop, state: stateOf(side, documents), commands });
        compareBars(
          `menus ${tag}`,
          mainSide.side.menus.resolveMenus(mode, envOf(mainSide.side)),
          plusSide.side.menus.resolveMenus(mode, envOf(plusSide.side)),
          false,
        );
        if (desktop && os === 'mac') {
          const nativeEnv = (side) => ({ ...envOf(side), modalOpen: false });
          compareBars(
            `native ${tag}`,
            mainSide.side.native.buildNativeMenu(mode, nativeEnv(mainSide.side)),
            plusSide.side.native.buildNativeMenu(mode, nativeEnv(plusSide.side)),
            true,
          );
        }
      }
    }
  }
}

// The key table and the lists beside it.
const mainKeys = mainSide.side.keys;
const plusKeys = plusSide.side.keys;
const mainChords = new Map();
for (const [id, entry] of Object.entries(mainKeys.KEYS)) {
  for (const system of ['win', 'mac'])
    for (const chord of entry?.[system] ?? []) mainChords.set(`${system} ${chord}`, id);
}
const addedKeys = [];
for (const [id, entry] of Object.entries(mainKeys.KEYS)) {
  comparisons += 1;
  if (JSON.stringify(plusKeys.KEYS[id]) !== JSON.stringify(entry)) {
    failures.push(`keys.ts KEYS["${id}"]: main ${JSON.stringify(entry)}, plus ${JSON.stringify(plusKeys.KEYS[id])}`);
  }
}
for (const [id, entry] of Object.entries(plusKeys.KEYS)) {
  if (id in mainKeys.KEYS) continue;
  addedKeys.push(`${id} ${JSON.stringify(entry)}`);
  for (const system of ['win', 'mac']) {
    for (const chord of entry?.[system] ?? []) {
      comparisons += 1;
      const taken = mainChords.get(`${system} ${chord}`);
      if (taken) failures.push(`keys.ts: the added ${id} takes ${system} ${chord}, which main gives ${taken}`);
    }
  }
}
for (const [name, value] of Object.entries(mainKeys)) {
  if (name === 'KEYS' || typeof value !== 'object' || value === null) continue;
  comparisons += 1;
  if (JSON.stringify(plusKeys[name]) !== JSON.stringify(value)) {
    failures.push(`keys.ts ${name}: main ${JSON.stringify(value)}, plus ${JSON.stringify(plusKeys[name])}`);
  }
}

await plusSide.close();
await mainSide.close();
rmSync(mainRoot, { recursive: true, force: true });
if (existsSync(join(repo, 'build', 'diff-menus'))) {
  rmSync(join(repo, 'build', 'diff-menus'), { recursive: true, force: true });
}

console.log(`main: ${mainRef} (${mainCommit}); plus: this working copy`);
console.log('');
console.log('What plus adds (after a separator at the end of a menu):');
const shown = new Map();
for (const [where, text] of additions) {
  const menu = where.replace(/^(menus|native) /, '$1 ');
  if (!shown.has(text)) shown.set(text, []);
  shown.get(text).push(menu);
}
for (const [text, wheres] of shown)
  console.log(`  ${wheres[0]}${wheres.length > 1 ? ` (and ${wheres.length - 1} more)` : ''}: ${text}`);
console.log(addedKeys.length === 0 ? 'keys.ts: no entry added' : `keys.ts entries added: ${addedKeys.join('; ')}`);
console.log('');
for (const failure of failures) console.log(`FAIL ${failure}`);
console.log(`${comparisons - failures.length} of ${comparisons} comparisons passed`);
if (jsonOut) {
  writeFileSync(
    jsonOut,
    `${JSON.stringify({ main: mainCommit, comparisons, failures, additions: Object.fromEntries(additions), addedKeys }, null, 1)}\n`,
  );
}
process.exit(failures.length === 0 ? 0 : 1);
