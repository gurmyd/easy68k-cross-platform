// The programs of the whole-program pixel regression and what each is given to do
// (ARCHITECTURE.md 6.5.4). Owner: X3.
//
// 6.5.4: "Every official example and twenty conformance programs with graphics are run headlessly to
// a fixed instruction count with scripted input". The three groups:
//
//   official     the ten programs of tests/corpus/official (the ones Help > Examples copies)
//   conformance  twenty programs of the simulator suite (tests/conformance/sim, owner T3) that draw:
//                the thirteen of trap15-b, and seven of trap15-a that leave text, colours and scrolled
//                graphics on the surface (the others of trap15-a end by clearing the screen)
//   scene        four programs of this folder (programs/) that draw what the others do not: every
//                kind of shape and pen, text in every font and style, the drawing modes with double
//                buffering, and a resized window
//
// This file reads the repository with `node:fs`: it is for Node (the Vitest run, and the check
// script through Vite's `ssrLoadModule`), not for the page. What goes to the page is the plain
// data of `PreparedProgram`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Bytes } from '../../../app/src/contracts';
import { createAsmEngine } from '../../../app/src/engine';
import { TEST_ASM_OPTIONS, TEST_ASM_TIME } from '../../../app/src/engine/testing';
import { assembleConformance } from '../sim/harness';
import { listPrograms } from '../sim/programs';
import type { PreparedProgram, Script } from './runner';

export const EXAMPLES_DIR: string = fileURLToPath(new URL('.', import.meta.url));
export const REPO_ROOT: string = join(EXAMPLES_DIR, '..', '..', '..');
export const OFFICIAL_DIR: string = join(REPO_ROOT, 'tests', 'corpus', 'official');
export const GOLDEN_PATH: string = join(EXAMPLES_DIR, 'golden', 'surfaces.json');

export type Origin = 'official' | 'conformance' | 'scene';

export interface Example {
  /** `official/tutorial1`, `conformance/trap15-b/b05-drawing-modes-0-15`, `scene/x01-shapes`. */
  id: string;
  origin: Origin;
  /** The source file, relative to the repository. */
  source: string;
  script: Script;
  /** Why the script is what it is, for a reader of the golden file. */
  note: string;
}

/** The instruction and time limits: far above what a finishing program needs, so only a program that does not finish meets them. */
export const DEFAULT_LIMITS = { instructions: 5_000_000, ms: 20_000 } as const;

/**
 * The number-guessing tutorials pick their number from the clock (task 8). The clock is virtual, so
 * the number is the same in every run (1 at the start); after a right guess a new game starts, and
 * 0 ends the program. Three wrong guesses, the right one, and 0.
 */
const GUESSES = ['50\n', '25\n', '5\n', '1\n', '0\n'];

const official = (name: string, script: Partial<Script> & { note: string }): Example => {
  const { note, ...rest } = script;
  return {
    id: `official/${name}`,
    origin: 'official',
    source: `tests/corpus/official/${name}.X68`,
    script: { limits: { ...DEFAULT_LIMITS }, ...rest },
    note,
  };
};

/** The ten official examples. The clocks and the demo of sounds never finish: they run for ten seconds of virtual time. */
export const OFFICIAL_EXAMPLES: readonly Example[] = [
  official('MACRO', { note: 'prints and halts' }),
  official('clockDigital', {
    limits: { instructions: DEFAULT_LIMITS.instructions, ms: 10_000 },
    note: 'a clock in the seven-segment display, never ends: ten seconds of virtual time',
  }),
  official('clockWithSound', {
    limits: { instructions: DEFAULT_LIMITS.instructions, ms: 10_000 },
    note: 'a clock face drawn with graphics, never ends: ten seconds of virtual time; silent audio',
  }),
  official('fileio', { note: 'writes, reads and deletes a file, then halts' }),
  official('graphicSound', { note: 'draws, plays sounds (silent audio), halts' }),
  official('mouseWindowSize', {
    limits: { instructions: DEFAULT_LIMITS.instructions, ms: 6_000 },
    keys: [],
    events: [
      { atMs: 1_000, keys: '2' },
      { atMs: 1_500, mouse: { kind: 'mouseMove', x: 200, y: 150, shift: 0 } },
      { atMs: 1_700, mouse: { kind: 'mouseDown', x: 200, y: 150, shift: 1 } },
      { atMs: 1_900, mouse: { kind: 'mouseUp', x: 200, y: 150, shift: 0 } },
      { atMs: 2_500, mouse: { kind: 'mouseMove', x: 420, y: 330, shift: 0 } },
      { atMs: 3_000, keys: '3' },
      { atMs: 3_500, mouse: { kind: 'mouseMove', x: 640, y: 500, shift: 0 } },
    ],
    exceptions: true,
    note: 'mouse moves and a click, then the window size changed by the keys 2 and 3; never ends: stops at the instruction limit (5,010,000 instructions, 4,944 ms of virtual time; the 6 s time limit is not reached)',
  }),
  official('tutorial1', { note: 'adds numbers and prints them' }),
  official('tutorial2', { keys: GUESSES, note: 'number guessing: three wrong guesses, the right one, then 0 to end' }),
  official('tutorial3', {
    keys: GUESSES,
    note: 'number guessing with macros: three wrong guesses, the right one, then 0 to end',
  }),
  official('tutorial4', { keys: ['12\n', '30\n', '7\n', '5\n'], note: 'asks for two numbers' }),
];

/** The twenty conformance programs: ids of the simulator suite (tests/conformance/sim). */
export const CONFORMANCE_IDS: readonly string[] = [
  'trap15-b/b01-text-background-fill',
  'trap15-b/b02-textout-moves-pen',
  'trap15-b/b03-pixel-obeys-mode',
  'trap15-b/b04-double-buffer-pen',
  'trap15-b/b05-drawing-modes-0-15',
  'trap15-b/b06-modes-above-15',
  'trap15-b/b07-rectangles',
  'trap15-b/b08-ellipse-and-flood',
  'trap15-b/b09-lines-and-pen',
  'trap15-b/b10-pen-width',
  'trap15-b/b11-get-pixel-outside',
  'trap15-b/b12-resize-clears-graphics',
  'trap15-b/b13-colour-forms',
  'trap15-a/a01-task14-at-home',
  'trap15-a/a06-task6-cursor-controls',
  'trap15-a/a07-task6-lf-last-row',
  'trap15-a/a17-task11-positions',
  'trap15-a/a20-scroll-moves-graphics',
  'trap15-a/a40-task25-scroll-rect',
  'trap15-a/a46-task21-colour-keeps-grid',
];

/** The scene programs of this folder, in programs/. */
export const SCENE_NAMES: readonly string[] = [
  'x01-shapes',
  'x02-text-and-fonts',
  'x03-modes-and-double-buffer',
  'x04-window-size',
];

/**
 * The conformance programs have their own start-up switches (`@switches`), which the examples take
 * over, and each is a "report" program that ends by halting.
 */
export function conformanceExamples(): Example[] {
  const programs = new Map(listPrograms().map((program) => [program.id, program]));
  return CONFORMANCE_IDS.map((id) => {
    const program = programs.get(id);
    if (!program) throw new Error(`the conformance program ${id} is not in tests/conformance/sim`);
    const switches = program.switches.map((s) => s.toLowerCase());
    return {
      id: `conformance/${id}`,
      origin: 'conformance',
      source: `tests/conformance/sim/${program.source}`,
      script: {
        limits: { ...DEFAULT_LIMITS },
        exceptions: switches.includes('/e'),
        bitField: switches.includes('/b'),
      },
      note: 'a self-reporting program of the simulator suite, run to its halt',
    } satisfies Example;
  });
}

export function sceneExamples(): Example[] {
  return SCENE_NAMES.map((name) => ({
    id: `scene/${name}`,
    origin: 'scene' as const,
    source: `tests/conformance/examples/programs/${name}.X68`,
    script: { limits: { ...DEFAULT_LIMITS } },
    note: 'a program of this folder, run to its halt',
  }));
}

/** Every example, in the order of the golden file. */
export function allExamples(): Example[] {
  return [...OFFICIAL_EXAMPLES, ...conformanceExamples(), ...sceneExamples()];
}

/* ----------------------------------------------------------------------------------- assembling */

const bytesOf = (path: string): Bytes => new Uint8Array(readFileSync(path));
const WAVS = ['0.wav', '1.wav', 'chime.wav', 'roger.wav', 'tick.wav', 'tock.wav'] as const;

/**
 * Assembles an example with the port's assembler and the options of a fresh installation, and
 * gathers the files it needs. The official examples are assembled from the folder they ship in (the
 * sounds beside them); the conformance programs through the simulator suite's own function, so that
 * `INCLUDE '..\dumplib.X68'` resolves.
 */
export async function prepareExample(example: Example): Promise<PreparedProgram> {
  if (example.origin === 'conformance') {
    const id = example.id.slice('conformance/'.length);
    const program = listPrograms().find((candidate) => candidate.id === id);
    if (!program) throw new Error(`no conformance program ${id}`);
    const assembled = await assembleConformance(program);
    return {
      id: example.id,
      stem: assembled.stem,
      s68: assembled.s68,
      l68: assembled.l68,
      files: assembled.files,
      script: example.script,
    };
  }
  const path = join(REPO_ROOT, ...example.source.split('/'));
  const name = example.source.slice(example.source.lastIndexOf('/') + 1);
  const stem = name.replace(/\.x68$/i, '');
  const asm = await createAsmEngine();
  const result = await asm.assemble(name, new Map([[name, bytesOf(path)]]), TEST_ASM_OPTIONS, TEST_ASM_TIME);
  if (result.fatal !== null) throw new Error(`${example.id}: ${result.fatal}`);
  if (result.errorCount > 0 || !result.sRecord || !result.listing) {
    const messages = result.messages.map((m) => `line ${m.line}: ${m.text}`).join('; ');
    throw new Error(`${example.id} does not assemble: ${result.errorCount} error(s): ${messages}`);
  }
  const files: Record<string, Bytes> = {};
  if (example.origin === 'official') for (const wav of WAVS) files[wav] = bytesOf(join(OFFICIAL_DIR, wav));
  return { id: example.id, stem, s68: result.sRecord, l68: result.listing, files, script: example.script };
}
