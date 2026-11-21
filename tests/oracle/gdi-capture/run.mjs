#!/usr/bin/env node
// `npm run oracle:gdi`: build and run the GDI capture, then compare its output with the committed
// references, or write them (ARCHITECTURE.md 6.2.3, 6.5). Windows only. Owner: T2.
//
//     node tests/oracle/gdi-capture/run.mjs            regenerate and compare (what CI runs)
//     node tests/oracle/gdi-capture/run.mjs --write    regenerate and update the committed files
//     options: --only cases,spots,nibs,fonts   --all (also compare the machine-dependent outputs)
//              --replace-references-from-other-windows (let --write replace references captured on
//              another Windows; see "Another Windows" in README.md)
//              --as-windows "10.0.26100 cp1252 96dpi" (judge as that Windows; to try the policy)
//              --from <dir> (judge a capture made elsewhere instead of capturing: the folder
//              build/gdi-capture/run of another machine, e.g. CI's gdi-capture-run artifact;
//              runs on any system, never writes the references; report in build/gdi-capture/review)
//
// What it produces (README.md next to this file has the details):
//
//   tests/conformance/gdi/golden/<suite>.pixpack.gz   one .pix per case of cases.ts (and of SH2's
//                                                     cases-ellipse.ts once it exists), packed
//   tests/conformance/gdi/golden/spots.json           the spot values of trap15-b, measured
//   tests/conformance/gdi/golden/nibs.json            the polygon of every wide pen 2-255 (WidenPath)
//   app/public/fonts/metrics.json                     the metric table of 3.5.1 + the raster rules
//   app/public/fonts/bitmap/*.bin                     the raster-font atlases (Fixedsys, Courier)
//   tools/fonts-src/windows-outline-metrics.tsv       what make-font-atlases.mjs needs from Windows
//
// The comparison is logical: the "capturedOn" record (Windows version, font smoothing) is ignored,
// and so are the outputs that depend on the machine's theme, font smoothing or fallback font (suites
// marked `machine` in cases.ts, the theme's system colours in spots.json, and what the control bytes
// $00-$08, $0B, $0E-$1B draw in the raster faces: machine-dependent.ts) unless --all is given. An
// output that is equal only without those bytes is listed as such, with what differs. A file is
// rewritten by --write only when its content changed, so two runs leave identical files.
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
import { byteRanges, describeAtlas, describeJson, describePack, describeTsv } from './describe-difference.ts';
import { canonicalAtlas, canonicalMetrics, canonicalSpots, OTHER_FONT_BYTES } from './machine-dependent.ts';

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
// --from <dir>: review a capture made on another machine (README.md "Another Windows").
const fromIndex = args.indexOf('--from');
const from = fromIndex >= 0 ? resolve(args[fromIndex + 1] ?? '.') : undefined;
const onlyIndex = args.indexOf('--only');
const only = new Set(onlyIndex >= 0 ? (args[onlyIndex + 1] ?? '').split(',') : ['cases', 'spots', 'nibs', 'fonts']);

const { generateCases, serializeCases, SUITES } = await import(pathToFileURL(join(GDI, 'cases.ts')).href);
const { encodePack, decodePack, decodeAtlas } = await import(pathToFileURL(join(GDI, 'pix.ts')).href);

const OTHER_FONT_BYTES_TEXT = byteRanges(OTHER_FONT_BYTES);

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

/** Runs the capture program, or with --from leaves the files of the given capture as they are. */
function capture(exe, argv) {
  return from ? Promise.resolve(`(${argv[0]}: the capture in ${from})\n`) : exec(exe, argv);
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

// ---------------------------------------------------------------------------------------------

// Each output has a canonical form: what the comparison looks at (without capturedOn, independent
// of compression and line ends). Two files are the same output when their canonical forms are equal.
// `strict` (optional) is the form that keeps the other-font bytes (machine-dependent.ts): an output
// whose canonical forms are equal and whose strict forms differ is reported as equal apart from them.
/** @type {{ path: string, bytes: Buffer | null, canon: (bytes: Buffer) => string, compared: boolean, note?: string, strict?: (bytes: Buffer) => string }[]} */
const artifacts = [];
const add = (path, bytes, canon, compared = true, note = undefined, strict = undefined) =>
  artifacts.push({ path, bytes, canon, compared, note, strict });
const sameBytes = (a, b) => Buffer.compare(a, b) === 0;
const rawBytes = (b) => b.toString('base64');
const atlasContent = (b) => canonicalAtlas(decodeAtlas(b), !all);
const atlasStrict = (b) => canonicalAtlas(decodeAtlas(b), false);
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
  if (!from) writeFileSync(listFile, serializeCases(cases));
  else {
    const missing = cases.filter((c) => !existsSync(join(out, 'pix', `${c.id}.pix`)));
    if (missing.length)
      throw new Error(
        `--from: ${out} has no capture of ${missing.length} cases of today's list (first ${missing[0].id}); ` +
          'it was captured with another case list. Use --only spots,fonts.',
      );
  }
  const started = Date.now();
  process.stdout.write(await capture(exe, ['cases', listFile, out]));
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
  process.stdout.write(await capture(exe, ['spots', out]));
  const json = readFileSync(join(out, 'spots.json'), 'utf8');
  JSON.parse(json); // must be valid
  // System colours follow the theme: only indices 5, 8, 15 and those above 30 are compared; the cell
  // the other-font bytes fill is the fallback font's (machine-dependent.ts).
  add(
    relative(repo, join(GOLDEN, 'spots.json')),
    Buffer.from(json.replaceAll('\r\n', '\n')),
    (b) => canonicalSpots(b.toString(), all),
    true,
    undefined,
    (b) => canonicalSpots(b.toString(), all, false),
  );
}

/** The pen nibs (docs/requests/SH2-gdi-nibs.md); compared without the capturedOn record. */
async function captureNibs(exe, out) {
  if (from && !existsSync(join(out, 'nibs.json'))) {
    console.log(`  (nibs: the capture in ${from} has no nibs.json; not compared)`);
    return;
  }
  process.stdout.write(await capture(exe, ['nibs', out]));
  const json = readFileSync(join(out, 'nibs.json'), 'utf8').replaceAll('\r\n', '\n');
  const canon = (b) => {
    const value = JSON.parse(b.toString());
    delete value.capturedOn;
    return JSON.stringify(value);
  };
  canon(Buffer.from(json)); // must be valid
  add(relative(repo, join(GOLDEN, 'nibs.json')), Buffer.from(json), canon);
}

async function captureFonts(exe, out) {
  const started = Date.now();
  process.stdout.write(await capture(exe, ['fonts', out]));
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
  add(
    relative(repo, join(FONTS, 'metrics.json')),
    Buffer.from(stringify(metrics) + '\n'),
    (b) => canonicalMetrics(b.toString(), !all),
    true,
    undefined,
    (b) => canonicalMetrics(b.toString(), false),
  );

  // The raster atlases, and any committed atlas that is no longer produced.
  const produced = new Set(readdirSync(join(out, 'bitmap')));
  for (const file of produced)
    add(
      relative(repo, join(FONTS, 'bitmap', file)),
      readFileSync(join(out, 'bitmap', file)),
      atlasContent,
      true,
      undefined,
      atlasStrict,
    );
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

/**
 * What differs between a committed output and the fresh capture, in a few lines (describe-difference.ts),
 * so that a CI log on another Windows says what that Windows draws differently.
 */
function describeDifference(artifact, old, strict = false) {
  try {
    const path = artifact.path.replaceAll('\\', '/');
    if (path.endsWith('.pixpack.gz')) return describePack(decodePack(old), decodePack(artifact.bytes));
    if (path.endsWith('.bin'))
      return describeAtlas(decodeAtlas(old), decodeAtlas(artifact.bytes), all ? [] : OTHER_FONT_BYTES);
    if (path.endsWith('.json')) {
      // A real difference is shown in the compared form; an other-font-only one in the strict form.
      const form = strict && artifact.strict ? artifact.strict : artifact.canon;
      return describeJson(JSON.parse(form(old)), JSON.parse(form(artifact.bytes)));
    }
    if (path.endsWith('.tsv')) return describeTsv(artifact.canon(old), artifact.canon(artifact.bytes));
  } catch (error) {
    return [`(could not describe the difference: ${error.message})`];
  }
  return [];
}

function report(lines, dir) {
  const text = lines.join('\n');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.txt'), text + '\n');
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
  if (from && write) {
    console.error('--from reviews a capture made elsewhere and never writes the references.');
    process.exit(1);
  }
  if (!from && process.platform !== 'win32') {
    console.error('npm run oracle:gdi measures Windows GDI and runs on Windows only (--from <dir> reviews a capture).');
    process.exit(1);
  }
  let exe = null;
  let out;
  let info;
  if (from) {
    out = from;
    const infoFile = ['fonts-info.json', 'cases-info.json'].map((f) => join(from, f)).find((f) => existsSync(f));
    if (!infoFile) throw new Error(`--from: ${from} has neither fonts-info.json nor cases-info.json`);
    info = JSON.stringify(JSON.parse(readFileSync(infoFile, 'utf8')).capturedOn);
  } else {
    exe = await buildCapture();
    console.log(`built ${relative(repo, exe)}`);
    out = join(BUILD_DIR, 'run');
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    info = (await exec(exe, ['info'])).trim();
  }
  // Where the report and the copies of differing files go (--from leaves the capture folder unchanged).
  const reportDir = from ? join(BUILD_DIR, 'review') : out;
  if (from) rmSync(reportDir, { recursive: true, force: true });
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
  if (only.has('nibs')) await captureNibs(exe, out);
  if (only.has('fonts')) await captureFonts(exe, out);

  const differences = [];
  const details = [];
  const otherFontOnly = [];
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
        if (old !== null && a.bytes !== null) {
          const lines = describeDifference(a, old);
          for (const line of lines) console.log(`              ${line}`);
          details.push(`${path}:`, ...lines.map((line) => `  ${line}`));
          // The captured file, for a person to compare (build/gdi-capture/run/differences/<path>).
          const copy = join(reportDir, 'differences', path);
          mkdirSync(dirname(copy), { recursive: true });
          writeFileSync(copy, a.bytes);
        }
      }
    } else if (!same) {
      console.log(`  skipped   ${a.path}: ${status}, ${a.note ?? 'not compared'}`);
    } else if (!write && a.strict && old !== null && a.bytes !== null && a.strict(old) !== a.strict(a.bytes)) {
      // Equal apart from what the other-font bytes draw (machine-dependent.ts): listed, not a difference.
      const path = a.path.replaceAll('\\', '/');
      const lines = describeDifference(a, old, true);
      console.log(`  same*     ${path} (equal apart from the other-font bytes)`);
      for (const line of lines) console.log(`              ${line}`);
      otherFontOnly.push(`${path}:`, ...lines.map((line) => `  ${line}`));
    }
  }
  const total = artifacts.length;
  if (write) {
    console.log(`${total} outputs, ${written} written, ${total - written} unchanged`);
    return;
  }
  const records = existsSync(OTHER_WINDOWS) ? JSON.parse(readFileSync(OTHER_WINDOWS, 'utf8')) : {};
  const verdict = judge({ machine, reference: reference ?? machine, differences, records });
  report(
    [
      `${total - differences.length} of ${total} outputs equal the committed references (${identical} byte for byte` +
        (otherFontOnly.length
          ? `; ${otherFontOnly.filter((l) => !l.startsWith(' ')).length} apart from the other-font bytes)`
          : ')'),
      ...verdict.lines,
      ...(details.length
        ? [
            '',
            `What differs (the captured files are in ${relative(repo, join(reportDir, 'differences'))}):`,
            ...details,
          ]
        : []),
      ...(otherFontOnly.length
        ? [
            '',
            `Equal apart from what the control bytes ${OTHER_FONT_BYTES_TEXT} draw, which Windows takes from a ` +
              'fallback font that depends on the Windows (machine-dependent.ts; not compared, run with --all to compare it):',
            ...otherFontOnly,
          ]
        : []),
    ],
    reportDir,
  );
  if (verdict.fail) process.exit(1);
}

main().catch((error) => {
  console.error(String(error.stack || error));
  process.exit(1);
});
