// decodeFile + stripTrailer + encodeForAssembler against the ground truth: for every program of the
// corpus, the exact bytes the official EDIT68K v5.16.1 (run under Wine) handed to its assembler
// after opening the file (build/ground-truth/asm/default/<source>/<name>.received.txt, sources
// under reference/examples). That data is not redistributable, so it is not in the repository: the
// test runs where build/ground-truth exists and is skipped, with the reason in its name, elsewhere.
// The ten official examples are also checked by format.test.ts from tracked fixtures.
//
// The same run compares stripTrailer with the engine's own loadEditorText (engine/asm/asm68k.mjs,
// ARCHITECTURE.md 10.3): same settings, same text, except that loadEditorText ends the text with
// CR LF where the file has no final line end and the official editor sends none.
//
// Sources from reference/examples/github/easy68k-qt are left out without being opened: that folder
// must not be used (task rules; docs/porting/errata/E1.md).

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TabType, type DocDefaults } from '../../contracts';
import { decodeFile, encodeForAssembler, stripTrailer } from './format';

const repo = (path: string) => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
const ROOT = repo('build/ground-truth/asm/default');
const MANIFEST = `${ROOT}/manifest.json`;
const present = existsSync(MANIFEST) && existsSync(repo('reference/examples'));

/** The Editor Options of a fresh installation (the defaults the oracle ran with). */
const DEFAULTS: DocDefaults = { fontName: 'Courier New', fontSize: 10, tabType: TabType.Fixed, tabSize: 4 };

interface ManifestFile {
  source: string;
  status: string;
  reliable?: boolean;
  source_features?: { final_newline: boolean; has_trailer: boolean };
}

interface EngineLoad {
  text: Uint8Array;
  tabType: 'assembly' | 'fixed' | null;
  tabSize: number | null;
  fontName: string | null;
  fontSize: number | null;
}

function cases(): ManifestFile[] {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { files: ManifestFile[] };
  return manifest.files.filter(
    (file) => file.status === 'ok' && file.reliable !== false && !file.source.includes('easy68k-qt'),
  );
}

function receivedPath(source: string): string {
  const name = source.slice(source.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');
  return `${ROOT}/${source}/${name}.received.txt`;
}

const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((value, i) => value === b[i]);

describe.skipIf(!present)('ground truth: the bytes the official editor gives the assembler', () => {
  it('decodeFile + stripTrailer + encodeForAssembler reproduce every reliable program (easy68k-qt left out)', () => {
    const all = cases();
    expect(all.length).toBeGreaterThanOrEqual(185);
    const wrong: string[] = [];
    let noFinalLineEnd = 0;
    for (const file of all) {
      const source = readFileSync(repo(`reference/examples/${file.source}`));
      const received = readFileSync(receivedPath(file.source));
      const loaded = stripTrailer(decodeFile(source), DEFAULTS);
      if (!equalBytes(encodeForAssembler(loaded.text), received)) wrong.push(file.source);
      if (loaded.loadError) wrong.push(`${file.source} (loadError)`);
      if (file.source_features && !file.source_features.final_newline) noFinalLineEnd++;
    }
    expect(wrong).toEqual([]);
    // The four files without a final line end and without a trailer are among them.
    expect(noFinalLineEnd).toBe(4);
  }, 120_000);

  it("stripTrailer agrees with the engine's loadEditorText (settings and text; final line end aside)", async () => {
    const engine = (await import(
      /* @vite-ignore */ new URL('../../../../engine/asm/asm68k.mjs', import.meta.url).href
    )) as { loadEditorText(bytes: Uint8Array): EngineLoad };
    const differences: string[] = [];
    let finalLineEndOnly = 0;
    for (const file of cases()) {
      const source = new Uint8Array(readFileSync(repo(`reference/examples/${file.source}`)));
      const ours = stripTrailer(decodeFile(source), DEFAULTS);
      const theirs = engine.loadEditorText(source);
      const settings = {
        tabType: theirs.tabType === null ? DEFAULTS.tabType : theirs.tabType === 'assembly' ? 0 : 1,
        tabSize: theirs.tabSize ?? DEFAULTS.tabSize,
        fontName: theirs.fontName ?? DEFAULTS.fontName,
        fontSize: theirs.fontSize ?? DEFAULTS.fontSize,
      };
      const mine = { tabType: ours.tabType, tabSize: ours.tabSize, fontName: ours.fontName, fontSize: ours.fontSize };
      if (JSON.stringify(mine) !== JSON.stringify(settings)) differences.push(`${file.source}: settings`);
      const text = encodeForAssembler(ours.text);
      if (equalBytes(text, theirs.text)) continue;
      const withCrLf = Uint8Array.from([...text, 0x0d, 0x0a]);
      if (!ours.text.endsWith('\n') && equalBytes(withCrLf, theirs.text)) finalLineEndOnly++;
      else differences.push(`${file.source}: text`);
    }
    expect(differences).toEqual([]);
    expect(finalLineEndOnly).toBe(4);
  }, 120_000);
});

describe.skipIf(present)(
  'ground truth (skipped: build/ground-truth or reference/examples is not on this machine)',
  () => {
    it.skip("the official editor's bytes are not redistributable; see the header of this file", () => {});
  },
);
