#!/usr/bin/env node
// Does what Windows draws on its text path depend on what the process drew before? (README.md,
// "Windows' text path"; errata T2 28 and 29.) Windows only. Owner: T2. A tool for a person, not a
// test that CI runs: it takes a few minutes and repeats the evidence of those errata.
//
//     node tests/oracle/gdi-capture/histories.mjs [--lists euro,at,fallback] [--fresh all|<n>]
//                                                 [--repeat <n>] [--out <dir>] [--write] [--keep]
//
// For each list it writes the case list (cases.ts's format) and runs the capture program
// (build/gdi-capture/gdi-capture.exe, built by build.mjs when missing; it draws into memory device
// contexts only and runs with windowsHide, so no window is shown) on it in several histories, then
// prints, per history, how many pens and pictures differ from the list captured in order of size,
// and how many pens are the same in every history.
//
//   lists     euro      $80 on the path: the cases of text-path-euro and those of text-control
//                       with $80 on the path, as cases.ts makes them, and "$80 $86" plain at every
//                       requested size (Courier 0-199, Fixedsys 0-121), and Courier 10 "$90 $80"
//             at        "@" on the path in Courier (7 strings, sizes 0-199, every style, a third of
//                       the combinations) and 90 Fixedsys cases: the list of erratum T2 28
//             fallback  the suite text-path-fallback ($01-$08 $0B $0E-$1B with a byte of $80 or
//                       above on the path)
//   histories committed  the committed references, where the list is a committed suite (captured
//                        by run.mjs after every earlier suite of cases.ts)
//             listed     the list in the order cases.ts gives it
//             size       in order of face and requested size (the order of fonts, which measured
//                        metrics.json raster.textPath.fallbackEuro)
//             reverse    the same, backwards
//             shuffled   in a random order (seed 0x5EED77)
//             prefix     after one Courier 127 plain "$90 $80" text, in order of size
//             twice      in order of size twice in one process: the first and the second pass
//             fresh      each case alone in a new process (--fresh <n>: every k-th case, n in all;
//                        default all for euro and fallback, 120 for at)
//
// --repeat  capture every history n times (default 1); a pen counts as the same in every history only
//           when every run of every history gives it.
// --write   euro only, and only with every case fresh: writes tests/conformance/gdi/golden/
//           text-path-euro-pens.json, the pens of the euro list that are the same in every history.
// --keep    keep the captures (default: only the pens and the digests of the pictures are kept, in
//           <out>/<list>-histories.json).
// --out     default build/gdi-capture/histories (git-ignored).

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildCapture, EXE } from './build.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const GDI = join(repo, 'tests', 'conformance', 'gdi');
const GOLDEN = join(GDI, 'golden');
const PENS_FILE = join(GOLDEN, 'text-path-euro-pens.json');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const lists = option('--lists', 'euro,at,fallback').split(',');
const freshOption = option('--fresh', '');
const outDir = resolve(option('--out', join(repo, 'build', 'gdi-capture', 'histories')));
const write = args.includes('--write');
const keep = args.includes('--keep');
const repeat = Number(option('--repeat', '1'));

const { generateCases, serializeCases, createRandom, FALLBACK_BYTES } = await import(
  pathToFileURL(join(GDI, 'cases.ts')).href
);
const { decodePack } = await import(pathToFileURL(join(GDI, 'pix.ts')).href);

if (process.platform !== 'win32') {
  console.error('histories.mjs runs the GDI capture and runs on Windows only.');
  process.exit(1);
}

// ---------------------------------------------------------------------------------------------
// The lists

const STYLE_NAMES = ['plain', 'bold', 'italic', 'underline', 'strike-out'];
const hex = (bytes) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
const fontOf = (c) => c.ops.find((o) => o.op === 'font');
const textOf = (c) => {
  const texts = c.ops.filter((o) => o.op === 'text');
  if (texts.length !== 1) throw new Error(`${c.id}: ${texts.length} texts; the lists here draw one`);
  return texts[0];
};
/** What a case draws, without its id: the key under which its pen is pinned. */
const keyOf = (c) => {
  const f = fontOf(c);
  return `${f.name}|${f.size}|${f.style}|${hex(textOf(c).bytes)}`;
};
const simple = (id, suite, name, size, style, bytes, width, height) => ({
  id,
  suite,
  width,
  height,
  ops: [
    { op: 'font', name, size, style },
    { op: 'fill', color: 0x0000ff },
    { op: 'fontcolor', color: 0x00ff00 },
    { op: 'text', x: 6, y: 2, bytes },
  ],
});

function euroList() {
  const all = generateCases();
  const suite = all.filter((c) => c.suite === 'text-path-euro');
  const control = all.filter(
    (c) =>
      c.suite === 'text-control' &&
      c.ops.some((o) => o.op === 'text' && o.bytes.includes(0x80) && !o.bytes.some((b) => FALLBACK_BYTES.includes(b))),
  );
  const sizes = [];
  for (let size = 0; size < 200; size++)
    sizes.push(simple(`euro-size-c${size}`, 'euro-size', 'Courier', size, 0, [0x80, 0x86], 600, 260));
  for (let size = 0; size < 122; size++)
    sizes.push(simple(`euro-size-f${size}`, 'euro-size', 'Fixedsys', size, 0, [0x80, 0x86], 600, 260));
  // The review's first measurement: Courier 10 "$90 $80" alone in a new process (fresh) and after a
  // Courier 127 euro text (prefix).
  const probe = simple('euro-probe-c10', 'euro-probe', 'Courier', 10, 0, [0x90, 0x80], 360, 150);
  return { cases: [...suite, ...control, ...sizes, probe], committed: ['text-path-euro', 'text-control'] };
}

function atList() {
  const STRINGS = [
    [0x40, 0x86],
    [0x40, 0x81],
    [0x86, 0x40],
    [0x40, 0x0d, 0x41],
    [0x40, 0x88, 0x40],
    [0x40, 0x7f],
    [0x41, 0x40, 0x0a],
  ];
  const cases = [];
  for (let size = 0; size < 200; size++)
    for (let style = 0; style < 5; style++)
      STRINGS.forEach((s, k) => {
        if ((size + style + k) % 3 === 0)
          cases.push(
            simple(`at-c${size}-${style}-${k}`, 'at', 'Courier', size, style, s, 12 + (s.length + 2) * 77 + 110, 210),
          );
      });
  for (let size = 0; size < 122; size += 7)
    for (let style = 0; style < 5; style++)
      cases.push(simple(`at-f${size}-${style}-0`, 'at', 'Fixedsys', size, style, STRINGS[0], 12 + 4 * 77 + 110, 210));
  return { cases, committed: [] };
}

function fallbackList() {
  return { cases: generateCases().filter((c) => c.suite === 'text-path-fallback'), committed: ['text-path-fallback'] };
}

const LISTS = { euro: euroList, at: atList, fallback: fallbackList };

/** In order of face and requested size; the sort keeps the list's order within a size. */
function bySize(cases) {
  const face = (c) => (fontOf(c).name === 'Fixedsys' ? 0 : 1);
  return [...cases].sort((a, b) => face(a) - face(b) || fontOf(a).size - fontOf(b).size);
}

const PREFIX = simple('prefix-courier-127-euro', 'prefix', 'Courier', 127, 0, [0x90, 0x80], 400, 220);
const PREFIX_SMALL = simple('prefix-courier-1-euro', 'prefix', 'Courier', 1, 0, [0x90, 0x80], 400, 220);

// ---------------------------------------------------------------------------------------------
// Capturing

function exec(argv) {
  return new Promise((resolvePromise, reject) => {
    // windowsHide: the capture program is a console program that draws into memory only.
    const child = spawn(EXE, argv, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolvePromise(out) : reject(new Error(`capture exit ${code}\n${out}`))));
  });
}

/** Captures `cases` in one process, in that order; returns id -> [pen moved, picture digest]. */
async function captureInOrder(dir, cases) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'pix'), { recursive: true });
  writeFileSync(join(dir, 'cases.txt'), serializeCases(cases));
  await exec(['cases', join(dir, 'cases.txt'), dir]);
  const x = new Map(cases.map((c) => [c.id, textOf(c).x]));
  const result = new Map();
  for (const line of readFileSync(join(dir, 'pen.txt'), 'utf8').split(/\r?\n/)) {
    const [id, px] = line.split(' ');
    if (!id) continue;
    const digest = createHash('sha1')
      .update(readFileSync(join(dir, 'pix', `${id}.pix`)))
      .digest('hex')
      .slice(0, 12);
    result.set(id, [Number(px) - x.get(id), digest]);
  }
  if (!keep) rmSync(dir, { recursive: true, force: true });
  return result;
}

/** Each case alone in a new process, four at a time. */
async function captureFresh(dir, cases) {
  const result = new Map();
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const c = cases[next++];
      const one = await captureInOrder(join(dir, c.id), [c]);
      result.set(c.id, one.get(c.id));
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (!keep) rmSync(dir, { recursive: true, force: true });
  return result;
}

/** The pens of the committed references of `suites` for the cases `ids` (their pictures are not digested). */
function committedPens(suites, ids) {
  const byKey = new Map();
  for (const suite of suites) {
    const file = join(GOLDEN, `${suite}.pixpack.gz`);
    if (!existsSync(file)) continue;
    const pack = decodePack(new Uint8Array(readFileSync(file)));
    const all = generateCases().filter((c) => c.suite === suite);
    pack.cases.forEach((p, i) => {
      const c = all[i];
      if (!c || c.id !== p.id) throw new Error(`${file} does not list ${c?.id}`);
      if (ids.has(c.id)) byKey.set(c.id, p.pen[0] - textOf(c).x);
    });
  }
  return byKey;
}

// ---------------------------------------------------------------------------------------------

let machine = '';

async function runList(name) {
  const { cases, committed } = LISTS[name]();
  if (cases.length === 0) throw new Error(`${name}: the list is empty`);
  const ordered = bySize(cases);
  const dir = join(outDir, name);
  const histories = {};
  const started = Date.now();
  console.log(`\n${name}: ${cases.length} cases`);

  const ids = new Set(cases.map((c) => c.id));
  const committedById = committedPens(committed, ids);
  if (committedById.size) histories.committed = new Map([...committedById].map(([id, pen]) => [id, [pen, null]]));
  const wanted = freshOption === 'all' ? cases.length : Number(freshOption || (name === 'at' ? 120 : cases.length));
  const step = Math.max(1, Math.floor(cases.length / Math.max(1, wanted)));
  const freshCases = cases.filter((_, i) => i % step === 0).slice(0, wanted);
  const prefixPens = [];
  for (let run = 1; run <= repeat; run++) {
    // The second and later runs repeat every history (Windows does not give the same results from
    // run to run in every history: see erratum T2 29); their names end in #2, #3, ...
    const tag = run === 1 ? '' : `#${run}`;
    histories[`listed${tag}`] = await captureInOrder(join(dir, 'listed'), cases);
    histories[`size${tag}`] = await captureInOrder(join(dir, 'size'), ordered);
    histories[`reverse${tag}`] = await captureInOrder(join(dir, 'reverse'), [...ordered].reverse());
    for (const [h, seed] of [
      ['shuffled', 0x5eed77],
      ['shuffled-2', 0x51ab3d],
    ]) {
      const random = createRandom(seed);
      const shuffled = [...cases];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      histories[`${h}${tag}`] = await captureInOrder(join(dir, h), shuffled);
    }
    for (const [h, first] of [
      ['prefix', PREFIX],
      ['prefix-small', PREFIX_SMALL],
    ]) {
      const prefixed = await captureInOrder(join(dir, h), [first, ...ordered]);
      if (run === 1) prefixPens.push(`${h} ${prefixed.get(first.id)?.[0]}`);
      prefixed.delete(first.id);
      histories[`${h}${tag}`] = prefixed;
    }
    const twice = await captureInOrder(join(dir, 'twice'), [
      ...ordered.map((c) => ({ ...c, id: `${c.id}~1` })),
      ...ordered.map((c) => ({ ...c, id: `${c.id}~2` })),
    ]);
    histories[`twice-1${tag}`] = new Map(ordered.map((c) => [c.id, twice.get(`${c.id}~1`)]));
    histories[`twice-2${tag}`] = new Map(ordered.map((c) => [c.id, twice.get(`${c.id}~2`)]));
    histories[`fresh${tag}`] = await captureFresh(join(dir, 'fresh'), freshCases);
  }
  if (!keep) rmSync(dir, { recursive: true, force: true });

  // ---- the comparison ----
  const names = Object.keys(histories);
  const base = histories.size;
  console.log(
    `  captured in ${((Date.now() - started) / 1000).toFixed(0)} s; histories: ${names.join(', ')}` +
      ` (fresh: ${freshCases.length} cases, each in a new process; prefix and prefix-small: Courier 127 and Courier 1 "$90 $80" first, their own pens: ${prefixPens.join(', ')})`,
  );
  for (const h of names) {
    if (h === 'size') continue;
    const map = histories[h];
    let pens = 0;
    let pictures = 0;
    let compared = 0;
    for (const [id, [pen, digest]] of map) {
      const [p, d] = base.get(id);
      compared++;
      if (pen !== p) pens++;
      if (digest !== null && digest !== d) pictures++;
    }
    console.log(
      `  ${h.padEnd(9)} against size order: pens differ in ${pens} of ${compared}` +
        (h === 'committed' ? '' : `, pictures in ${pictures}`),
    );
  }
  const rows = cases.map((c) => {
    const values = names.map((h) => histories[h].get(c.id)).filter(Boolean);
    const pens = new Set(values.map((v) => v[0]));
    const pictures = new Set(values.filter((v) => v[1] !== null).map((v) => v[1]));
    return {
      c,
      pen: base.get(c.id)[0],
      stablePen: pens.size === 1,
      stablePicture: pictures.size === 1,
      seen: values.length,
    };
  });
  const groups = new Map();
  for (const r of rows) {
    const f = fontOf(r.c);
    const high = textOf(r.c).bytes.some((b) => b >= 0x80) ? 'with a byte >= $80' : 'no byte >= $80';
    const g = `${r.c.suite} ${f.name}${name === 'at' ? `, ${high}` : ''}`;
    const k = groups.get(g) ?? { n: 0, pens: 0, pictures: 0 };
    k.n++;
    if (r.stablePen) k.pens++;
    if (r.stablePicture) k.pictures++;
    groups.set(g, k);
  }
  console.log('  the same in every history:');
  for (const [g, k] of groups) console.log(`    ${g}: pens ${k.pens} of ${k.n}, pictures ${k.pictures} of ${k.n}`);
  const unstable = rows.filter((r) => !r.stablePen);
  for (const r of unstable.slice(0, 12)) {
    const f = fontOf(r.c);
    console.log(
      `    e.g. ${r.c.id} ${f.name} ${f.size} ${STYLE_NAMES[f.style]} [${hex(textOf(r.c).bytes)}]: ` +
        names.map((h) => `${h} ${histories[h].get(r.c.id)?.[0] ?? '-'}`).join(', '),
    );
  }

  if (name === 'at') {
    const file = join(GOLDEN, 'text-path-at-pens.json');
    if (existsSync(file)) {
      const doc = JSON.parse(readFileSync(file, 'utf8'));
      const stable = new Map(
        rows.filter((r) => r.stablePen && fontOf(r.c).name === 'Courier').map((r) => [keyOf(r.c), r.pen]),
      );
      const held = doc.cases.filter(
        ([size, style, h, pen]) => stable.get(`Courier|${size}|${style}|${h}`) === pen,
      ).length;
      console.log(
        `  ${relative(repo, file)}: ${held} of ${doc.cases.length} pinned pens are the same in every history here`,
      );
    }
  }
  if (name === 'euro') {
    if (existsSync(PENS_FILE)) {
      const doc = JSON.parse(readFileSync(PENS_FILE, 'utf8'));
      const stable = stableByKey(rows);
      const held = doc.cases.filter(
        ([face, size, style, h, pen]) => stable.get(`${face}|${size}|${style}|${h}`) === pen,
      ).length;
      console.log(
        `  ${relative(repo, PENS_FILE)}: ${held} of ${doc.cases.length} pinned pens are the same in every history here`,
      );
    }
    if (write) {
      if (freshCases.length !== cases.length) throw new Error('--write needs every case fresh (--fresh all)');
      writePens(rows, names, cases.length);
    }
  }
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, `${name}-histories.json`),
    JSON.stringify(
      Object.fromEntries(names.map((h) => [h, Object.fromEntries([...histories[h]].map(([id, v]) => [id, v]))])),
    ),
  );
  console.log(`  pens and picture digests of every history: ${relative(repo, join(outDir, `${name}-histories.json`))}`);
}

/** key -> the pen every history gave, or null; a text two lists both draw must be stable in both. */
function stableByKey(rows) {
  const pens = new Map();
  for (const r of rows) {
    const key = keyOf(r.c);
    const known = pens.get(key);
    pens.set(key, r.stablePen && (known === undefined || known === r.pen) ? r.pen : null);
  }
  return pens;
}

function writePens(rows, names, total) {
  const pens = stableByKey(rows);
  const seen = new Set();
  const cases = [];
  for (const r of rows) {
    const key = keyOf(r.c);
    if (seen.has(key) || pens.get(key) === null) continue;
    seen.add(key);
    const f = fontOf(r.c);
    cases.push([f.name, f.size, f.style, hex(textOf(r.c).bytes), r.pen]);
  }
  const doc = {
    about:
      'Pen positions of task 95 for texts with $80 on Windows\' text path in the raster faces (gate I3 item 3d, erratum T2 29), written by tests/oracle/gdi-capture/histories.mjs --lists euro --write. Each text of the list (the cases of text-path-euro, those of text-control with $80 on the path, and "$80 $86" plain at every requested size) was captured in the histories named below; in Courier the width Windows gives the euro sign depends on what the process drew before. These are the texts whose pen was the same in every history. Each case: [face, size, style (0 plain, 1 bold, 2 italic, 3 underline, 4 strike-out), bytes (hex), how far the pen moved].',
    capturedOn: JSON.parse(machine),
    histories: names,
    listed: total,
    cases,
  };
  const lines = [
    '{',
    ...Object.entries(doc)
      .filter(([k]) => k !== 'cases')
      .map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)},`),
    ' "cases": [',
    cases.map((c) => `  ${JSON.stringify(c)}`).join(',\n'),
    ' ]',
    '}',
    '',
  ];
  writeFileSync(PENS_FILE, lines.join('\n'));
  console.log(`  written ${relative(repo, PENS_FILE)}: ${cases.length} pens`);
}

if (!existsSync(EXE)) await buildCapture();
machine = (await exec(['info'])).trim();
console.log(`capture program ${relative(repo, EXE)}; machine ${machine}`);
for (const name of lists) {
  if (!LISTS[name]) throw new Error(`unknown list ${name} (euro, at, fallback)`);
  await runList(name);
}
if (existsSync(outDir) && readdirSync(outDir).length === 0) rmSync(outDir, { recursive: true });
