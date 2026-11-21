// decodeFile + stripTrailer + encodeForAssembler against the tracked corpus (ARCHITECTURE.md 6.3):
// tests/corpus/manifest.json holds, for every program, the SHA-256 of the text the official EDIT68K
// v5.16.1 (under Wine) handed to its assembler after opening the file with its default settings.
// The sources of the sets `official`, `github-mit` and `conformance` (the checklist programs and the
// RichEdit stress files) are in the repository, so this test runs everywhere, CI included; the
// `site` set is checked too where `node tools/fetch-site-examples.mjs` has fetched it.
//
// It replaces the earlier ground-truth.test.ts, which read the untracked build/ground-truth capture
// of the same programs. Three RichEdit stress files are known to come out differently under Wine
// (bare CR at the end of the file, NUL, UTF-8 byte-order mark: tests/conformance/asm/golden/
// REPORT.md); whether Windows does the same is not known (official-oracle §3.4), so they are listed
// here, and the test fails as soon as one of them starts to match, so that the list stays true.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TabType, type DocDefaults } from '../../contracts';
import { decodeFile, encodeForAssembler, stripTrailer } from './format';

const repo = (path: string) => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
const MANIFEST = repo('tests/corpus/manifest.json');

/** Where each set's sources are (tests/corpus/index.ts, SET_DIRECTORIES). */
const SET_DIRECTORIES: Readonly<Record<string, string>> = {
  official: 'tests/corpus/official',
  'github-mit': 'tests/corpus/github',
  conformance: 'tests/conformance/asm',
  site: 'build/corpus-local/site',
};

/** The Editor Options of a fresh installation (the defaults the oracle ran with). */
const DEFAULTS: DocDefaults = { fontName: 'Courier New', fontSize: 10, tabType: TabType.Fixed, tabSize: 4 };

/** Wine's RichEdit differs from the editor's documented load for these (golden/REPORT.md). */
const WINE_DEVIATIONS = ['richedit/s05_bare_cr.X68', 'richedit/s12_nul_in_comment.X68', 'richedit/s16_utf8_bom.X68'];

interface Program {
  id: string;
  set: string;
  file: string;
  sha256: string;
  runs: Record<string, { status: string; received?: string }>;
}

/**
 * Where the engine's loadEditorText differs from stripTrailer beyond the final line end. Empty: a
 * trailer line too short to read (erratum 2 of docs/porting/errata/E1.md) occurs in no corpus file.
 */
const ENGINE_DIFFERENCES: string[] = [];

interface EngineLoad {
  text: Uint8Array;
  tabType: 'assembly' | 'fixed' | null;
  tabSize: number | null;
  fontName: string | null;
  fontSize: number | null;
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((value, i) => value === b[i]);

interface Available {
  program: Program;
  source: Uint8Array;
  /** SHA-256 of the received text of every run with a result (the same text for all runs). */
  received: string[];
}

/** Programs with a result whose source is here; problems with the tracked sources go to `problems`. */
function availableSources(problems: string[] = []): Available[] {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { programs: Program[] };
  const out: Available[] = [];
  for (const program of manifest.programs) {
    // The editor's load does not depend on the assembler options, so every run of a program
    // received the same text; a program without a default run is checked through its other runs.
    const received = Object.values(program.runs).flatMap((run) =>
      run.status === 'ok' && run.received ? [run.received] : [],
    );
    const directory = SET_DIRECTORIES[program.set];
    if (received.length === 0 || directory === undefined) continue;
    const path = repo(`${directory}/${program.file}`);
    if (!existsSync(path)) {
      // Only the fetched `site` set may be missing; a tracked source must be there.
      if (program.set !== 'site') problems.push(`${program.id} (source missing)`);
      continue;
    }
    const source = new Uint8Array(readFileSync(path));
    if (sha256(source) !== program.sha256) problems.push(`${program.id} (source differs from the manifest)`);
    else out.push({ program, source, received });
  }
  return out;
}

describe('the tracked corpus: the text the official editor gives the assembler', () => {
  it('decodeFile + stripTrailer + encodeForAssembler give the received text of every available program', () => {
    const wrong: string[] = [];
    const checked: Record<string, number> = {};
    for (const { program, source, received } of availableSources(wrong)) {
      const loaded = stripTrailer(decodeFile(source), DEFAULTS);
      const ours = sha256(encodeForAssembler(loaded.text));
      if (received.some((hash) => hash !== ours) || loaded.loadError) wrong.push(program.id);
      checked[program.set] = (checked[program.set] ?? 0) + 1;
    }
    expect(wrong.sort()).toEqual([...WINE_DEVIATIONS].sort());
    // The tracked sets are all there: 10 official, 41 of 42 github-mit (GFX.X68 has no result), and
    // 119 of 122 conformance programs (checklist and RichEdit stress; three runs have no result).
    expect(checked['official']).toBe(10);
    expect(checked['github-mit'] ?? 0).toBeGreaterThanOrEqual(41);
    expect(checked['conformance'] ?? 0).toBeGreaterThanOrEqual(119);
    // Where the site set has been fetched, all of its 134 programs are checked as well.
    if (existsSync(repo(SET_DIRECTORIES['site'] as string))) expect(checked['site']).toBe(134);
  }, 60_000);

  it("stripTrailer agrees with the engine's loadEditorText (settings and text; final line end aside)", async () => {
    // engine/asm/asm68k.mjs is tracked JavaScript without imports; loadEditorText needs no wasm.
    const engine = (await import(
      /* @vite-ignore */ new URL('../../../../engine/asm/asm68k.mjs', import.meta.url).href
    )) as { loadEditorText(bytes: Uint8Array): EngineLoad };
    const differences: string[] = [];
    const finalLineEndOnly: string[] = [];
    for (const { program, source } of availableSources()) {
      const ours = stripTrailer(decodeFile(source), DEFAULTS);
      const theirs = engine.loadEditorText(source);
      const settings = {
        tabType: theirs.tabType === null ? DEFAULTS.tabType : theirs.tabType === 'assembly' ? 0 : 1,
        tabSize: theirs.tabSize ?? DEFAULTS.tabSize,
        fontName: theirs.fontName ?? DEFAULTS.fontName,
        fontSize: theirs.fontSize ?? DEFAULTS.fontSize,
      };
      const mine = { tabType: ours.tabType, tabSize: ours.tabSize, fontName: ours.fontName, fontSize: ours.fontSize };
      if (JSON.stringify(mine) !== JSON.stringify(settings)) differences.push(`${program.id}: settings`);
      const text = encodeForAssembler(ours.text);
      if (equalBytes(text, theirs.text)) continue;
      // loadEditorText ends a text without a final line end with CR LF; the official editor does not
      // (docs/porting/errata/E1.md entry 1). The assembled output is the same either way.
      const withCrLf = Uint8Array.from([...text, 0x0d, 0x0a]);
      if (!ours.text.endsWith('\n') && equalBytes(withCrLf, theirs.text)) finalLineEndOnly.push(program.id);
      else differences.push(`${program.id}: text`);
    }
    expect(differences.sort()).toEqual(ENGINE_DIFFERENCES);
    // Erratum 1 on tracked data: the official editor sent these without a final CR LF.
    const tracked = finalLineEndOnly.filter((id) => !id.startsWith('site/')).sort();
    expect(tracked).toEqual([
      'checklist/textmode-02-last-line-without-line-end-gets-one-editor-save',
      'richedit/s08_no_final_newline.X68',
      'richedit/s11_ctrl_z_end.X68',
    ]);
    if (existsSync(repo(SET_DIRECTORIES['site'] as string))) {
      expect(finalLineEndOnly.filter((id) => id.startsWith('site/')).sort()).toEqual([
        'site/games/invader/background.x68',
        'site/games/lightsout/background.x68',
        'site/games/lightsout/lightsout.x68',
        'site/graphics/bmp_load/bmp_load.x68',
      ]);
    }
  }, 60_000);
});
