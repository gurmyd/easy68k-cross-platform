#!/usr/bin/env node
// `npm run oracle:gdi`: build and run the GDI capture, then compare its output with the committed
// references, or write them (ARCHITECTURE.md 6.2.3, 6.5). Windows only. Owner: T2.
//
//     node tests/oracle/gdi-capture/run.mjs            regenerate and compare (what CI runs)
//     node tests/oracle/gdi-capture/run.mjs --write    regenerate and update the committed files
//     options: --only cases,spots,fonts   --all (also compare the machine-dependent outputs)
//              --replace-references-from-other-windows (let --write replace references captured on
//              another Windows; see "Another Windows" in README.md)
//              --as-windows "10.0.26100 cp1252 96dpi" (judge as that Windows; to try the policy)
//
// What it produces (README.md next to this file has the details):
//
//   tests/conformance/gdi/golden/<suite>.pixpack.gz   one .pix per case of cases.ts (and of SH2's
//                                                     cases-ellipse.ts once it exists), packed
//   tests/conformance/gdi/golden/spots.json           the spot values of trap15-b, measured
//   app/public/fonts/metrics.json                     the metric table of 3.5.1 + the raster rules
//   app/public/fonts/bitmap/*.bin                     the raster-font atlases (Fixedsys, Courier)
//   tools/fonts-src/windows-outline-metrics.tsv       what make-font-atlases.mjs needs from Windows
//
// The comparison is logical: the "capturedOn" record (Windows version, font smoothing) is ignored,
// and so are the outputs that depend on the machine's theme or font smoothing (suites marked
// `machine` in cases.ts, the theme's system colours in spots.json) unless --all is given. A file
// is rewritten by --write only when its content changed, so two runs leave identical files.
//
// Another Windows (windows-policy.ts, README.md): the committed references are the standard. On
// the Windows they were captured on, every difference fails. On another Windows the differences
// must be the ones other-windows.json records for that Windows; anything else fails, and --write
// refuses to replace the references there.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildCapture, BUILD_DIR } from './build.mjs';
import { fingerprint, judge, mayWrite, windowsIdentity } from './windows-policy.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const GDI = join(repo, 'tests', 'conformance', 'gdi');
const GOLDEN = join(GDI, 'golden');
const FONTS = join(repo, 'app', 'public', 'fonts');
const FONTS_SRC = join(repo, 'tools', 'fonts-src');

const args = process.argv.slice(2);
const write = args.includes('--write');
const all = args.includes('--all');
const overrideWindows = args.includes('--replace-references-from-other-windows');
const OTHER_WINDOWS = join(here, 'other-windows.json');
// --as-windows <identity>: judge as if this machine were that Windows (to try the policy out).
const asWindowsIndex = args.indexOf('--as-windows');
const asWindows = asWindowsIndex >= 0 ? args[asWindowsIndex + 1] : undefined;
const onlyIndex = args.indexOf('--only');
const only = new Set(onlyIndex >= 0 ? (args[onlyIndex + 1] ?? '').split(',') : ['cases', 'spots', 'fonts']);

const { generateCases, serializeCases, SUITES } = await import(pathToFileURL(join(GDI, 'cases.ts')).href);
const { encodePack, decodePack } = await import(pathToFileURL(join(GDI, 'pix.ts')).href);

const STYLE_NAMES = { '-': 'plain', b: 'bold', i: 'italic', u: 'underline', s: 'strikeOut' };

function exec(file, argv) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolvePromise(out) : reject(new Error(`${file} ${argv[0]} failed (exit ${code})\n${out}`)),
    );
  });
}

function tsvRows(text) {
  return text
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('\t'));
}

/** JSON with arrays of plain values kept on one line (readable diffs for large tables). */
function stringify(value, indent = '') {
  const inner = indent + '  ';
  const flat = (v) =>
    v === null || typeof v !== 'object' || (Array.isArray(v) && v.every((e) => e === null || typeof e !== 'object'));
  if (flat(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.every(flat)) return `[\n${value.map((v) => inner + JSON.stringify(v)).join(',\n')}\n${indent}]`;
    return `[\n${value.map((v) => inner + stringify(v, inner)).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(value).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${stringify(v, inner)}`);
  return `{\n${entries.join(',\n')}\n${indent}}`;
}

const withoutCapturedOn = (json) => {
  const copy = JSON.parse(json);
  delete copy.capturedOn;
  return JSON.stringify(copy);
};

// ---------------------------------------------------------------------------------------------

// Each output has a canonical form: what the comparison looks at (without capturedOn, independent
// of compression and line ends). Two files are the same output when their canonical forms are equal.
/** @type {{ path: string, bytes: Buffer | null, canon: (bytes: Buffer) => string, compared: boolean, note?: string }[]} */
const artifacts = [];
const add = (path, bytes, canon, compared = true, note = undefined) =>
  artifacts.push({ path, bytes, canon, compared, note });
const sameBytes = (a, b) => Buffer.compare(a, b) === 0;
const rawBytes = (b) => b.toString('base64');
const packContent = (b) => {
  const p = decodePack(b);
  return JSON.stringify([p.suite, p.cases.map((c) => [c.id, c.pen, Buffer.from(c.pix).toString('base64')])]);
};

async function captureCases(exe, out) {
  let cases = generateCases();
  const ellipseFile = join(GDI, 'cases-ellipse.ts');
  if (existsSync(ellipseFile)) {
    // SH2's ellipse cases (6.5.2): the module exports generateEllipseCases(): GdiCase[].
    const module = await import(pathToFileURL(ellipseFile).href);
    cases = cases.concat(module.generateEllipseCases());
  }
  const listFile = join(out, 'cases.txt');
  writeFileSync(listFile, serializeCases(cases));
  const started = Date.now();
  process.stdout.write(await exec(exe, ['cases', listFile, out]));
  console.log(`  (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  const capturedOn = JSON.parse(readFileSync(join(out, 'cases-info.json'), 'utf8')).capturedOn;
  const pens = new Map(
    readFileSync(join(out, 'pen.txt'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const [id, x, y] = l.split(' ');
        return [id, [Number(x), Number(y)]];
      }),
  );
  const machine = new Map(SUITES.map((s) => [s.name, s.machine]));
  const suites = [...new Set(cases.map((c) => c.suite))];
  for (const suite of suites) {
    const packed = cases
      .filter((c) => c.suite === suite)
      .map((c) => ({ id: c.id, pen: pens.get(c.id), pix: readFileSync(join(out, 'pix', `${c.id}.pix`)) }));
    const bytes = Buffer.from(encodePack({ suite, capturedOn, cases: packed }));
    const isMachine = machine.get(suite) ?? false;
    add(
      relative(repo, join(GOLDEN, `${suite}.pixpack.gz`)),
      bytes,
      packContent,
      !isMachine || all,
      isMachine ? 'depends on the machine (theme or font smoothing)' : undefined,
    );
  }
}

async function captureSpots(exe, out) {
  process.stdout.write(await exec(exe, ['spots', out]));
  const json = readFileSync(join(out, 'spots.json'), 'utf8');
  JSON.parse(json); // must be valid
  // System colours follow the theme: only indices 5, 8, 15 and those above 30 are compared.
  const stable = (text) => {
    const v = JSON.parse(text);
    delete v.capturedOn;
    if (!all) {
      v.sysColors = v.sysColors.map((c, i) => ([5, 8, 15].includes(i) || i > 30 ? c : null));
      for (const key of Object.keys(v.colourForms)) {
        const n = parseInt(key, 16);
        if (n & 0x80000000 && ![5, 8, 15].includes(n & 0xff) && (n & 0xff) <= 30) delete v.colourForms[key];
      }
    }
    return JSON.stringify(v);
  };
  add(relative(repo, join(GOLDEN, 'spots.json')), Buffer.from(json.replaceAll('\r\n', '\n')), (b) =>
    stable(b.toString()),
  );
}

async function captureFonts(exe, out) {
  const started = Date.now();
  process.stdout.write(await exec(exe, ['fonts', out]));
  console.log(`  (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  const capturedOn = JSON.parse(readFileSync(join(out, 'fonts-info.json'), 'utf8')).capturedOn;

  // metrics.json (6.5.3): { capturedOn, faces, faceKinds, fonts: { name: { style: [[w, h, face] x 256] } }, raster }
  const faces = [];
  const faceKinds = [];
  const fonts = {};
  for (const [name, style, size, colWidth, rowHeight, face, kind] of tsvRows(
    readFileSync(join(out, 'metrics.tsv'), 'utf8'),
  )) {
    let index = faces.indexOf(face);
    if (index < 0) {
      index = faces.push(face) - 1;
      faceKinds.push(kind);
    }
    const styleName = STYLE_NAMES[style];
    ((fonts[name] ??= {})[styleName] ??= [])[Number(size)] = [Number(colWidth), Number(rowHeight), index];
  }
  const atlases = tsvRows(readFileSync(join(out, 'atlases.tsv'), 'utf8')).map(
    ([file, face, style, cellWidth, cellHeight, glyphWidth, overhang, blank]) => ({
      file: `bitmap/${file}`,
      face,
      style: STYLE_NAMES[style],
      cellWidth: Number(cellWidth),
      cellHeight: Number(cellHeight),
      glyphWidth: Number(glyphWidth),
      overhang: Number(overhang),
      blankBytes: blank === '-' ? [] : blank.split(',').map(Number),
    }),
  );
  // A cell that no rule reproduces (result "captured"; none on the reference Windows) is kept in
  // metrics.json with "ruleHolds": false, so that metrics.json differs from the references and the
  // comparison reports it like any other difference.
  const unruled = [];
  const cells = tsvRows(readFileSync(join(out, 'raster-rules.tsv'), 'utf8')).map(
    ([face, style, plainWidth, plainHeight, native, kx, ky, result, lineRows, lineExceptions]) => {
      const styleName = STYLE_NAMES[style];
      const captured = result === 'captured';
      if (captured) unruled.push(`${face} ${styleName} ${plainWidth}x${plainHeight}`);
      // At native size (kx = ky = 1) the styled glyphs are also stored as an atlas of their own.
      const exactAtlas =
        kx === '1' && ky === '1'
          ? atlases.find((a) => a.face === face && a.style === styleName && a.cellHeight === Number(plainHeight))
          : undefined;
      return {
        face,
        style: styleName,
        plainCell: [Number(plainWidth), Number(plainHeight)],
        native: `bitmap/${native}`,
        kx: Number(kx),
        ky: Number(ky),
        atlas: exactAtlas ? exactAtlas.file : null,
        lineRows: lineRows === '-' ? [] : lineRows.split(',').map(Number),
        lineExceptions:
          lineExceptions === '-'
            ? {}
            : Object.fromEntries(lineExceptions.split(',').map((e) => e.split(':').map(Number))),
        ...(captured ? { ruleHolds: false } : {}),
      };
    },
  );
  if (unruled.length)
    console.log(`no rule reproduces ${unruled.length} raster cells on this Windows: ${unruled.join(', ')}`);
  const metrics = {
    about:
      'Measured by tests/oracle/gdi-capture (npm run oracle:gdi) with GetTextFace and GetTextExtentPoint32 on fonts made as the VCL makes them. fonts[name][style][size] = [colWidth = TextWidth("W"), rowHeight = TextHeight("Xp"), index into faces]. raster: how every raster cell is made from the atlases (see tests/oracle/gdi-capture/README.md).',
    capturedOn,
    faces,
    faceKinds,
    fonts,
    raster: {
      rules: {
        plain: 'P(x, y) = native(floor(x / kx), floor(y / ky)); advance = kx * native advance',
        bold: 'P(x, y) | P(x - 1, y); advance + 1 where the native advance is not 0',
        italic: 'P(x - (floor((cellHeight - 1) / 2) - floor(y / 2)), y); advance unchanged',
        underline:
          'P(x, y) | (y in lineRows and x < advance); for the bytes in lineExceptions the line is that many pixels long',
        strikeOut: 'as underline, with the strike-out rows',
      },
      atlases,
      cells,
    },
  };
  add(relative(repo, join(FONTS, 'metrics.json')), Buffer.from(stringify(metrics) + '\n'), (b) =>
    withoutCapturedOn(b.toString()),
  );

  // The raster atlases, and any committed atlas that is no longer produced.
  const produced = new Set(readdirSync(join(out, 'bitmap')));
  for (const file of produced)
    add(relative(repo, join(FONTS, 'bitmap', file)), readFileSync(join(out, 'bitmap', file)), rawBytes);
  if (existsSync(join(FONTS, 'bitmap'))) {
    for (const file of readdirSync(join(FONTS, 'bitmap'))) {
      if (file.endsWith('.bin') && !produced.has(file))
        add(relative(repo, join(FONTS, 'bitmap', file)), null, rawBytes);
    }
  }

  // Outline faces: placement data for tools/make-font-atlases.mjs.
  const outline = readFileSync(join(out, 'outline.tsv'), 'utf8').replaceAll('\r\n', '\n');
  add(
    relative(repo, join(FONTS_SRC, 'windows-outline-metrics.tsv')),
    Buffer.from(
      `# capturedOn ${JSON.stringify(capturedOn)}\n# written by tests/oracle/gdi-capture/run.mjs; do not edit\n${outline}`,
    ),
    // Compared without the capturedOn line and independent of the checkout's line ends.
    (b) => b.toString().replaceAll('\r\n', '\n').split('\n').slice(1).join('\n'),
  );
}

/** Identity of the Windows the committed references were captured on (metrics.json), or null. */
function referenceIdentity() {
  const file = join(FONTS, 'metrics.json');
  if (!existsSync(file)) return null;
  const { capturedOn } = JSON.parse(readFileSync(file, 'utf8'));
  return capturedOn ? windowsIdentity(capturedOn) : null;
}

function report(lines) {
  const text = lines.join('\n');
  writeFileSync(join(BUILD_DIR, 'run', 'report.txt'), text + '\n');
  // On GitHub Actions the report also goes to the job summary, where the record can be copied.
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### GDI capture\n\n\`\`\`\n${text}\n\`\`\`\n`, { flag: 'a' });
    } catch {
      // the summary is a convenience; the console has the same text
    }
  }
  console.log(text);
}

async function main() {
  if (process.platform !== 'win32') {
    console.error('npm run oracle:gdi measures Windows GDI and runs on Windows only.');
    process.exit(1);
  }
  const exe = await buildCapture();
  console.log(`built ${relative(repo, exe)}`);
  const out = join(BUILD_DIR, 'run');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const info = (await exec(exe, ['info'])).trim();
  console.log(`machine: ${info}`);
  const machine = asWindows ?? windowsIdentity(JSON.parse(info));
  const reference = referenceIdentity();
  if (write && !mayWrite({ machine, reference, override: overrideWindows })) {
    console.error(
      `--write refused: the references were captured on ${reference}, this is ${machine}. The committed references ` +
        'are the standard, and another Windows does not replace them. Compare without --write; to accept this ' +
        "Windows' differences, record them in tests/oracle/gdi-capture/other-windows.json (README.md, " +
        '"Another Windows"). Only to move the references to this Windows on purpose, add ' +
        '--replace-references-from-other-windows.',
    );
    process.exit(1);
  }
  if (only.has('cases')) await captureCases(exe, out);
  if (only.has('spots')) await captureSpots(exe, out);
  if (only.has('fonts')) await captureFonts(exe, out);

  const differences = [];
  let written = 0;
  let identical = 0;
  for (const a of artifacts) {
    const file = join(repo, a.path);
    const exists = existsSync(file);
    const old = exists ? readFileSync(file) : null;
    const same = a.bytes === null ? !exists : old !== null && a.canon(old) === a.canon(a.bytes);
    if (old !== null && a.bytes !== null && sameBytes(old, a.bytes)) identical++;
    const status = same ? 'same' : a.bytes === null ? 'no longer produced' : exists ? 'DIFFERENT' : 'missing';
    if (!same && (a.compared || write)) {
      if (write) {
        mkdirSync(dirname(file), { recursive: true });
        if (a.bytes === null) unlinkSync(file);
        else writeFileSync(file, a.bytes);
        written++;
        console.log(`  written   ${a.path} (${status})`);
      } else {
        const path = a.path.replaceAll('\\', '/');
        differences.push({ path, fingerprint: a.bytes === null ? 'removed' : fingerprint(a.canon(a.bytes)) });
        console.log(`  ${status.padEnd(9)} ${path}`);
      }
    } else if (!same) {
      console.log(`  skipped   ${a.path}: ${status}, ${a.note ?? 'not compared'}`);
    }
  }
  const total = artifacts.length;
  if (write) {
    console.log(`${total} outputs, ${written} written, ${total - written} unchanged`);
    return;
  }
  const records = existsSync(OTHER_WINDOWS) ? JSON.parse(readFileSync(OTHER_WINDOWS, 'utf8')) : {};
  const verdict = judge({ machine, reference: reference ?? machine, differences, records });
  report([
    `${total - differences.length} of ${total} outputs equal the committed references (${identical} byte for byte)`,
    ...verdict.lines,
  ]);
  if (verdict.fail) process.exit(1);
}

main().catch((error) => {
  console.error(String(error.stack || error));
  process.exit(1);
});
