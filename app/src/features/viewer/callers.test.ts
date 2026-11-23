// Which opens may reach the viewer (ARCHITECTURE-PLUS P3.4.1). Owner: N6.
//
// Only a person's own Open (the Files panel, Open File..., a drop, a start-up argument or a launched
// file) asks the viewer; everything else opens text as before the stage, and nothing on the
// assembler's or the simulator's paths may be diverted (the gate's finding: the assembler's opening
// of include files went through the viewer). Three kinds of proof:
//   1. An inventory of every call of DocumentService.open in the application's sources, each with
//      the reason it may (a person's Open) or may not (`{ asText: true }`) reach the viewer.
//   2. Only the document service consults the viewer; no file read of the assembler or the
//      simulator goes near it (they read through the file system, collect.ts and the session).
//   3. The real assembler: a program that INCLUDEs and INCBINs files the viewer would take assembles
//      to the same bytes, messages and counts with the viewer on as with it off, and the viewer is
//      never shown anything.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AsmEngine, FileDialogs, VPath, ViewerService } from '../../contracts';
import type { DocumentManager } from '../../core/documents/service';
import { createAsmEngine } from '../../engine';
import { bytesOf, textOf } from '../../engine/testing';
import { MemoryBackend } from '../../fs/memory-backend';
import { createTestApplication } from '../../state/testing';
import { createDocumentService } from '../documents';
import { assembleDocument, type AssembleDeps } from '../assemble/assemble';
import { assembleDeps } from '../assemble';
import { viewerKindOf } from './classify';

const SRC = fileURLToPath(new URL('../../', import.meta.url));
const repo = (path: string) => fileURLToPath(new URL(`../../../../${path}`, import.meta.url));
const asmBuilt = existsSync(repo('engine/dist/asm68k.wasm')) && existsSync(repo('engine/dist/asm68k-loader.mjs'));
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

/** The application's own sources: no tests, no browser checks, no test helpers. */
function sources(dir = SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === 'gallery') continue;
      out.push(...sources(path));
    } else if (
      /\.(ts|tsx)$/.test(name) &&
      !/\.test\.tsx?$/.test(name) &&
      name !== 'testing.ts' &&
      name !== 'check-harness.tsx'
    ) {
      out.push(path);
    }
  }
  return out;
}
const rel = (path: string) => relative(SRC, path).split(sep).join('/');

/** Every `documents.open(...)` call: `file: the call's text`. */
function openCalls(): string[] {
  const calls: string[] = [];
  for (const file of sources()) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\bdocuments\.open\(([^)]*)\)/g)) {
      // Doc comments that quote the call are not calls.
      const line = text.slice(text.lastIndexOf('\n', match.index) + 1, match.index);
      if (/^\s*(\/\/|\*|\/\*\*)/.test(line)) continue;
      calls.push(`${rel(file)}: open(${match[1]})`);
    }
  }
  return calls.sort();
}

/**
 * Every call, with why it may reach the viewer. `person`: a person's own Open (P3.4.1).
 * `text`: asks for text. `request`: not a person's Open, still without `{ asText: true }` in a file
 * no package of the stage owns; docs/requests/N6-include-as-text.md asks for the argument.
 */
const CALLERS: readonly (readonly [string, 'person' | 'text' | 'request'])[] = [
  // Simulator mode's Assembler Status dialog, `Load L68`: a person's choice; a .L68 always opens as
  // text (P3.4.1), so it never reaches the viewer.
  ['features/assemble/index.ts: open(status.listingPath)', 'person'],
  // The include files that the assembler's error rows refer to (routeMessages).
  ['features/assemble/assemble.ts: open(path, { asText: true })', 'text'],
  // Open File...
  ['features/documents/commands.ts: open(path)', 'person'],
  // A start-up argument (?open=, the desktop app's argument), and files handed over later
  // (Platform.onOpenFiles).
  ['features/documents/index.ts: open(file)', 'person'],
  ['features/documents/index.ts: open(file)', 'person'],
  // The Files panel: a row opened; a dropped file (drop.ts's openDocument); the desktop app's
  // dropped folder (the files the person chooses in it).
  ['features/files/FilesPanel.tsx: open(row.path)', 'person'],
  ['features/files/index.ts: open(path)', 'person'],
  ['features/files/index.ts: open(path)', 'person'],
  // The banner's "Open the containing folder...": reopens documents that are already open (closed
  // first), not a person's Open of a file; asks for text (docs/requests/N6-include-as-text.md).
  ['features/files-fsaccess/controller.ts: open(target, { asText: true })', 'text'],
  // Help > Examples: the example the person chooses in the Open File dialog.
  ['features/help/commands.ts: open(first)', 'person'],
  // A file launched with the installed web app (a start-up argument, main 5.7).
  ['features/pwa/index.ts: open(path)', 'person'],
  // The viewer's own Open as Text.
  ['features/viewer/service.tsx: open(path, { asText: true })', 'text'],
];

describe('the callers of DocumentService.open (ARCHITECTURE-PLUS P3.4.1)', () => {
  it('every call in the application is listed with the reason it may or may not reach the viewer', () => {
    expect(openCalls()).toEqual(CALLERS.map(([call]) => call).sort());
  });

  it("a call listed as text passes { asText: true }; every other one is a person's own Open or a request", () => {
    for (const [call, kind] of CALLERS) {
      if (kind === 'text') expect(call).toContain('{ asText: true }');
      else expect(call).not.toContain('asText');
    }
  });

  it('only the document service, the documents feature and the viewer itself touch the viewer', () => {
    const allowed = new Set([
      'contracts/features.ts',
      'contracts/index.ts',
      'core/documents/service.ts',
      'features/documents/index.ts',
      // The feature list hands createViewerService to the bootstrap.
      'features/index.ts',
      'bootstrap.ts',
      'state/services.ts',
      'state/stub-services.ts',
    ]);
    const touching = sources()
      .map((file) => ({ file: rel(file), text: readFileSync(file, 'utf8') }))
      .filter(({ file }) => !file.startsWith('features/viewer/'))
      .filter(({ text }) => /\bctx\.viewer\b|\bdeps\.viewer\b|\bViewerService\b|createViewerService/.test(text))
      .map(({ file }) => file)
      .filter((file) => !allowed.has(file));
    expect(touching).toEqual([]);
  });

  it("the assembler's and the simulator's file reads do not go through the document service", () => {
    // The assembler reads INCLUDE and INCBIN files from the file system (collect.ts); the simulator,
    // its file tasks and EASyBIN read through the session and the file system. None opens a document.
    const paths = sources()
      .map(rel)
      .filter((file) =>
        /^(features\/assemble\/collect\.ts|features\/(sim-files|sim-main|run|easybin|memory|log)\/|engine\/)/.test(
          file,
        ),
      );
    expect(paths.length).toBeGreaterThan(5);
    for (const file of paths) {
      expect(readFileSync(join(SRC, file), 'utf8'), file).not.toMatch(/\bdocuments\.open\(/);
    }
  });
});

/* ------------------------------------------------------------------------------- the assembler */

/** A viewer that takes what the real table of P3.4.1 gives to the viewer, and records each show. */
function tableViewer(): ViewerService & { asked: string[]; shown: string[] } {
  const asked: string[] = [];
  const shown: string[] = [];
  return {
    asked,
    shown,
    wants: (path, bytes) => {
      asked.push(path);
      return viewerKindOf(path, bytes) !== null;
    },
    show: (path) => void shown.push(path),
  };
}

function openWindow(asm: AsmEngine, viewer: ViewerService | null) {
  const backend = new MemoryBackend({ mount: 'browser', kind: 'memory', label: 'My Programs' });
  const fileDialogs: FileDialogs = {
    open: async () => null,
    save: async () => null,
    chooseFolder: async () => null,
    linkFileHandle: async () => null,
    registerProvider: () => () => {},
  };
  const app = createTestApplication({
    features: [],
    services: {
      createDocumentService,
      createFileDialogs: () => fileDialogs,
      ...(viewer ? { createViewerService: () => viewer } : {}),
    },
    backends: [backend],
    asm,
  });
  const deps: AssembleDeps = { ...assembleDeps(app.ctx), asm, messageBox: async () => 'OK' };
  return { app, deps, documents: app.ctx.documents as DocumentManager };
}

const PICTURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52];
const BINARY = [0x7f, 0x45, 0x4c, 0x46, 0, 1, 2, 3, 0, 0, 0x41];

/** The program and its files: an INCLUDE of text saved as .svg, INCBINs of a .png and a binary. */
async function writeProgram(app: ReturnType<typeof openWindow>['app'], withError: boolean) {
  const vfs = app.ctx.vfs;
  await vfs.writeFile(
    '/browser/inc/main.X68',
    bytesOf(
      [
        '        ORG     $1000',
        "        INCLUDE 'lib.svg'",
        "START:  INCBIN  'photo.png'",
        "        INCBIN  'data.bin'",
        '        SIMHALT',
        '        END     START',
        '',
      ].join('\r\n'),
    ),
  );
  await vfs.writeFile(
    '/browser/inc/lib.svg',
    bytesOf(['VALUE   EQU     5', withError ? '        BOGUS   D0' : '        DC.W    VALUE', ''].join('\r\n')),
  );
  await vfs.writeFile('/browser/inc/photo.png', Uint8Array.from(PICTURE));
  await vfs.writeFile('/browser/inc/data.bin', Uint8Array.from(BINARY));
}

async function assembleIn(viewer: ReturnType<typeof tableViewer> | null, withError = false) {
  const asm = await createAsmEngine();
  const w = openWindow(asm, viewer);
  await writeProgram(w.app, withError);
  const doc = await w.documents.open('/browser/inc/main.X68');
  if (!doc) throw new Error('main.X68 did not open');
  const outcome = await assembleDocument(w.deps, doc.id);
  const read = async (path: VPath) =>
    (await w.app.ctx.vfs.stat(path)) ? [...(await w.app.ctx.vfs.readFile(path))] : null;
  const state = w.app.ctx.store.getState();
  return {
    w,
    doc,
    outcome: outcome.kind,
    summary: state.assemble[doc.id],
    listing: await read('/browser/inc/main.L68'),
    sRecord: await read('/browser/inc/main.S68'),
    messages: state.messages,
    documents: w.documents.list().map((entry) => ({ path: entry.path, kind: entry.kind })),
  };
}

describe.skipIf(!asmBuilt && !enginesRequired)(
  'the assembler with the viewer on (ARCHITECTURE-PLUS P1.1 rule 1)',
  () => {
    it('needs engine/dist', () => {
      expect(asmBuilt, 'engine/dist is missing and EASY68K_REQUIRE_ENGINES=1').toBe(true);
    });

    it('INCLUDE and INCBIN of files the viewer takes: the same .L68, .S68, messages and counts as with the viewer off; nothing reaches the viewer', async () => {
      const viewer = tableViewer();
      const on = await assembleIn(viewer);
      const off = await assembleIn(null);
      expect(on.outcome).toBe('done');
      expect(on.summary?.errors).toBe(0);
      expect(on.listing).not.toBeNull();
      expect(on.sRecord).not.toBeNull();
      // The INCBINs are in the program: the picture's and the binary file's bytes, in order.
      const s68 = textOf(Uint8Array.from(on.sRecord ?? []));
      expect(s68).toContain('89504E470D0A1A0A');
      expect(on.listing).toEqual(off.listing);
      expect(on.sRecord).toEqual(off.sRecord);
      expect({ ...on.summary, at: 0 }).toEqual({ ...off.summary, at: 0 });
      expect(Object.values(on.messages)).toEqual(Object.values(off.messages));
      expect(on.documents).toEqual(off.documents);
      // Only main.X68 itself was ever asked about (the person's Open of it), and nothing was shown.
      expect(viewer.asked).toEqual(['/browser/inc/main.X68']);
      expect(viewer.shown).toEqual([]);
    }, 60_000);

    // docs/requests/N6-include-as-text.md (applied at the gate): E5's routeMessages opens an include
    // file that error rows refer to with `open(path, { asText: true })`, so the viewer never takes
    // `lib.svg`. Before the request this case failed: the viewer was shown `/browser/inc/lib.svg`.
    it('an include file with errors that the viewer would take opens as text and holds its rows', async () => {
      const viewer = tableViewer();
      const on = await assembleIn(viewer, true);
      const off = await assembleIn(null, true);
      expect(on.summary?.errors).toBeGreaterThan(0);
      expect(viewer.shown).toEqual([]);
      expect(on.documents).toEqual(off.documents);
      expect(on.documents.map((entry) => entry.path)).toContain('/browser/inc/lib.svg');
    }, 60_000);
  },
);
