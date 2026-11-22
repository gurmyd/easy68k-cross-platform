// The Files panel keeps the seven properties of the safety net (ARCHITECTURE-PLUS P3.3.1; the last
// acceptance item of P5 N5): N5's own bulk delete, move, copy, rename and undo code, driven by
// seeded sequences (seeds 1 to 200) against the real store (createMemoryHistoryService) over a
// memory Vfs, with checkHistoryInvariants of fs/history-model.ts (N3) after every step.
//
// The commands run as the panel runs them (bulk.ts deleteItems, move.ts transferItems, actions.ts
// renameRefused/afterRename around store.ts renameChecked, undo.ts through the stack); every question
// is answered from the seed. Around them: saves and opens (record), a program that writes or
// removes a file, the `history` switch, the clock with a global pass, and commands aimed at a Git
// repository, which must change nothing below its .git folder.
//
// EASY68K_N5_SEEDS=<n> sets how many seeds run (default 200), EASY68K_N5_SEED=<n> runs one alone and
// prints its steps; EASY68K_N5_STEPS sets the steps per seed (default 60).

import { describe, expect, it } from 'vitest';
import type { Bytes, HistoryService, MessageBoxRequest, Vfs, VPath } from '../../contracts';
import { CANNOT_BE_UNDONE } from '../../core/history/texts';
import { basename, dirname, foldCase } from '../../core/paths/winpath';
import { createMemoryHistoryService, historyDatabaseOf } from '../../fs/history-memory';
import { checkHistoryInvariants, createHistoryModel, editText, seededRandom } from '../../fs/history-model';
import { MemoryBackend } from '../../fs/memory-backend';
import { createVfs } from '../../fs/vfs';
import { afterRename, renameRefused } from './actions';
import { deleteItems, type UndoEntry } from './bulk';
import { transferItems } from './move';
import { renameChecked } from './rename';
import { fakeDocuments, filesTestDeps, scriptedDialogs } from './testing';

const ONE = process.env.EASY68K_N5_SEED ? Number(process.env.EASY68K_N5_SEED) : null;
const SEEDS = ONE !== null ? 1 : Number(process.env.EASY68K_N5_SEEDS ?? 200);
const STEPS = Number(process.env.EASY68K_N5_STEPS ?? 60);
const FIRST = ONE ?? 1;
const MB = 1 << 20;

interface Stats {
  [key: string]: number;
}

/**
 * Every file and folder below a folder named .git (any letter case) in any store, with its bytes
 * (a folder: 'dir'). A FILE named .git (a work tree's pointer) is not below one and is left out.
 */
async function belowGit(vfs: Vfs): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (dir: VPath, inGit: boolean) => {
    for (const entry of await vfs.list(dir).catch(() => [])) {
      const path = `${dir}/${entry.name}` as VPath;
      const git = inGit || (entry.kind === 'dir' && foldCase(entry.name) === foldCase('.git'));
      if (entry.kind === 'dir') {
        if (git) out.set(path, 'dir');
        await walk(path, git);
      } else if (inGit) {
        out.set(path, Buffer.from(await vfs.readFile(path)).toString('base64'));
      }
    }
  };
  for (const backend of vfs.backends()) await walk(`/${backend.mount}` as VPath, false);
  return out;
}

async function runSeed(seed: number, trace: string[], stats: Stats): Promise<string | null> {
  const random = seededRandom(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const chance = (p: number) => random() < p;
  const count = (key: string) => (stats[key] = (stats[key] ?? 0) + 1);

  let fileTime = 1_000;
  const raw = createVfs();
  raw.mount(new MemoryBackend({ mount: 'browser', kind: 'browser', label: 'My Programs', now: () => ++fileTime }));
  raw.mount(new MemoryBackend({ mount: 'disk', kind: 'disk', label: 'This computer', now: () => ++fileTime }));
  // An opened folder (/folder): the store keys its places by the root it gives the folder, found by
  // name for a backend without a handle (history-db.ts findRoot), and so does N3's checker (errata N3,
  // "The model places an opened folder", third round of the gate; errata N5 entry 12).
  raw.mount(new MemoryBackend({ mount: 'folder', kind: 'fsaccess', label: 'Lab', now: () => ++fileTime }));

  let now = Date.UTC(2026, 10, 2, 9, 0, 0);
  const clock = { now: () => now, wallTime: () => new Date(now) };
  const switchOn = { on: true };
  const listeners = new Set<() => void>();
  const settings = {
    get: () => ({ app: { plus: { viewer: true, history: switchOn.on } } }) as never,
    update: () => {},
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  type Store = HistoryService & { settled(): Promise<void>; globalPass?(): Promise<void> };
  let store = null as unknown as Store;
  const model = createHistoryModel(raw, () => historyDatabaseOf(store as HistoryService));
  store = createMemoryHistoryService({
    vfs: model.storeVfs,
    clock,
    scheduler: { setTimer: () => () => {}, onFrame: () => () => {} },
    settings: settings as never,
  }) as never;
  const history = model.watch(store as HistoryService);

  const text = (n: number) => {
    let out = '';
    while (out.length < n) out += `\tMOVE.L\tD${Math.floor(random() * 8)},D${Math.floor(random() * 8)}\r\n`;
    return Uint8Array.from(out.slice(0, n), (c) => c.charCodeAt(0));
  };
  // A Git repository saved before (Save is unchanged below .git): no command may touch its .git.
  await raw.writeFile('/browser/repo/.git/HEAD', text(40));
  await raw.writeFile('/browser/repo/main.X68', text(300));
  for (const path of [
    '/browser/a/p.X68',
    '/browser/a/q.X68',
    '/browser/b/r.X68',
    '/disk/lab/s.X68',
    '/disk/p.X68',
    '/folder/p.X68',
    '/folder/lab2/q.X68',
  ])
    await raw.writeFile(path, text(500 + Math.floor(random() * 3000)));
  await model.adoptFiles();

  // A Yes to a question that said "This cannot be undone." lets the command lose bytes for good.
  let lossAccepted: boolean; // set false before each step
  const answer = (request: MessageBoxRequest): string => {
    if (request.buttons.length === 1) return request.buttons[0] as string;
    if (request.buttons.includes('Cancel') && chance(0.15)) return 'Cancel';
    if (request.buttons.includes('No') && chance(0.25)) return 'No';
    if (request.text.includes(CANNOT_BE_UNDONE)) lossAccepted = true;
    return 'Yes';
  };
  const deps = filesTestDeps({
    vfs: model.vfs,
    history,
    dialogs: scriptedDialogs(answer),
    documents: fakeDocuments(),
  });

  const folders: VPath[] = [
    '/browser',
    '/browser/a',
    '/browser/b',
    '/browser/a/sub',
    '/disk',
    '/disk/lab',
    '/folder',
    '/folder/lab2',
  ];
  const names = ['p.X68', 'q.X68', 'r.X68', 's.X68', 't.X68', 'pic.png'];
  const files = () => [...model.files.keys()].filter((p) => !p.includes('/.git/'));
  const someItems = (): VPath[] => {
    const pool = [
      ...files(),
      '/browser/a',
      '/browser/b',
      '/disk/lab',
      '/browser/a/sub',
      '/browser/repo',
      '/folder/lab2',
    ];
    const n = 1 + Math.floor(random() * 3);
    // Now and then a selection as Ctrl+A leaves it: a folder with files inside it, or the same
    // item twice (verify round 1).
    const loose = chance(0.3);
    const out: VPath[] = [];
    for (let i = 0; i < n; i++) {
      const p = pick(pool);
      if (loose || !out.some((q) => q === p || q.startsWith(`${p}/`) || p.startsWith(`${q}/`))) out.push(p);
    }
    // Now and then two files of the same name (letter case ignored) from different folders.
    if (chance(0.2)) {
      const byName = new Map<string, VPath[]>();
      for (const f of files()) byName.set(foldCase(basename(f)), [...(byName.get(foldCase(basename(f))) ?? []), f]);
      const twins = [...byName.values()].filter((list) => list.length > 1);
      if (twins.length > 0) {
        const list = pick(twins);
        out.push(...list.slice(0, 2).filter((f) => !out.includes(f)));
      }
    }
    return out;
  };
  // The oracle of verify round 1: the bytes of every file before a command are still somewhere
  // after it (at a path, or as a copy the Trash promised), unless a question that said "This
  // cannot be undone." was answered Yes. checkHistoryInvariants cannot see a loss that is a write
  // the command itself made.
  const key = (bytes: Bytes) => Buffer.from(bytes).toString('base64');
  const lostBytes = (before: Map<VPath, Bytes>): string[] => {
    const present = new Set<string>();
    for (const bytes of model.files.values()) present.add(key(bytes));
    for (const p of model.promises) if (p.half === 'trash') present.add(key(p.bytes));
    const lost: string[] = [];
    for (const [path, bytes] of before) {
      if (path.includes('/.git/')) continue;
      if (!present.has(key(bytes))) lost.push(path);
    }
    return lost;
  };
  const ORACLE = new Set(['delete', 'move', 'copy', 'rename', 'undo']);

  type Command = [number, string, () => Promise<string>];
  const commands: Command[] = [
    [
      20,
      'save',
      async () => {
        const path = `${pick(folders)}/${pick(names)}`;
        if ((await model.vfs.stat(path).catch(() => null))?.kind === 'dir') return 'save (a folder there)';
        const old = model.files.get(path);
        const data: Bytes = path.endsWith('.png')
          ? Uint8Array.from({ length: 300 }, () => Math.floor(random() * 256))
          : old && chance(0.7)
            ? editText(random, old)
            : text(400 + Math.floor(random() * 4000));
        await model.vfs.writeFile(path, data);
        void history.record(path, data, 'saved', now).catch(() => model.violations.push('(3) record rejected'));
        return `save ${path}`;
      },
    ],
    [
      14,
      'delete',
      async () => {
        const items = someItems();
        const outcome = await deleteItems(deps, items);
        return `delete ${items.join(', ')}: ${outcome.deleted.length} deleted, ${outcome.remaining.length} left`;
      },
    ],
    [
      10,
      'move',
      async () => {
        // Mostly within one store (a move); now and then across stores (a copy) or at the repository.
        let items = someItems();
        // Now and then a selection that names the repository's .git folder itself (the tree never
        // lists it; a command given one must still refuse it).
        if (chance(0.05)) items = [...items, pick(['/browser/repo/.git', '/browser/repo/.GIT'])];
        let into = pick([...folders, '/browser/repo/.git', '/browser/repo']);
        if (chance(0.7)) {
          const mount = (items[0] as VPath).split('/')[1] as string;
          items = items.filter((item) => item.startsWith(`/${mount}/`));
          into = pick(folders.filter((f) => f === `/${mount}` || f.startsWith(`/${mount}/`)));
        }
        // Now and then into the folder one of the items is in already (verify round 1).
        if (chance(0.15) && items.length > 0) into = dirname(pick(items));
        const outcome = await transferItems(deps, items, into);
        return `move ${items.join(', ')} -> ${into}: ${outcome.mode}, ${outcome.written.length} files`;
      },
    ],
    [
      6,
      'copy',
      async () => {
        const items = someItems();
        const into = chance(0.15) && items.length > 0 ? dirname(pick(items)) : pick(folders);
        const outcome = await transferItems(deps, items, into, 'copy');
        return `copy ${items.join(', ')} -> ${into}: ${outcome.written.length} files`;
      },
    ],
    [
      6,
      'rename',
      async () => {
        const from = pick([...files(), '/browser/a', '/browser/repo', '/disk/lab', '/browser/a/sub', '/folder/lab2']);
        if (!(await model.vfs.stat(from).catch(() => null))) return `rename ${from}: gone`;
        if (await renameRefused(deps, from)) return `rename ${from}: refused`;
        const name = basename(from);
        // Now and then the name .git in some letter case: a folder must never become one (P1.1
        // rule 2, verify round 2); a file may.
        const to = chance(0.15)
          ? pick(['.git', '.GIT', '.Git'])
          : chance(0.4)
            ? name === name.toUpperCase()
              ? name.toLowerCase()
              : name.toUpperCase()
            : `n${name}`;
        try {
          const renamed = await renameChecked(model.vfs, from, to);
          await afterRename(deps, from, renamed);
          return `rename ${from} -> ${renamed}`;
        } catch (error) {
          return `rename ${from}: ${String(error)}`;
        }
      },
    ],
    [
      10,
      'undo',
      async () => {
        const entry = deps.stack.peek();
        if (!entry) return 'undo (nothing)';
        const back = await deps.undo.run(entry as UndoEntry, chance(0.5));
        return `undo ${entry.kind}: ${back.length} back`;
      },
    ],
    [
      3,
      'program',
      async () => {
        const list = files();
        if (list.length === 0) return 'a program (nothing)';
        const path = pick(list);
        if (chance(0.5)) await model.vfs.remove(path);
        else await model.vfs.writeFile(path, text(200));
        return `a program changes ${path}`;
      },
    ],
    [
      2,
      'switch',
      async () => {
        switchOn.on = !switchOn.on;
        for (const listener of [...listeners]) listener();
        return `the history switch ${switchOn.on ? 'on' : 'off'}`;
      },
    ],
    [
      3,
      'clock',
      async () => {
        now += pick([60_000, 3_600_000, 86_400_000, 31 * 86_400_000]);
        model.note({ pass: true, now, budget: 64 * MB });
        await store.globalPass?.();
        return 'the clock moves; a global pass';
      },
    ],
  ];
  const total = commands.reduce((n, [w]) => n + w, 0);

  model.note({ now, budget: 64 * MB });
  const first = await checkHistoryInvariants(historyDatabaseOf(store as HistoryService), raw, model);
  if (first.length > 0) return `before step 1: ${first.join('; ')}`;
  for (let step = 1; step <= STEPS; step++) {
    model.note({ now, budget: 64 * MB });
    let r = random() * total;
    let chosen = commands[0] as Command;
    for (const command of commands) {
      r -= command[0];
      if (r < 0) {
        chosen = command;
        break;
      }
    }
    count(chosen[1]);
    const before = new Map(model.files);
    const gitBefore = await belowGit(raw);
    lossAccepted = false;
    let line: string;
    try {
      line = await chosen[2]();
    } catch (error) {
      line = `${chosen[1]} threw: ${String(error)}`;
      count('threw');
    }
    await (store as { settled(): Promise<void> }).settled();
    trace.push(`${step}: ${line}`);
    if (ORACLE.has(chosen[1])) {
      if (lossAccepted) count('loss accepted');
      else {
        const lost = lostBytes(before);
        if (lost.length > 0) {
          if (ONE !== null) {
            const show = (m: Map<VPath, Bytes>) =>
              [...m].filter(([p]) => !p.includes('.git')).map(([p, b]) => `${p}=${key(b).slice(0, 8)}/${b.length}`);
            console.log(
              'before',
              show(before),
              '\nafter',
              show(model.files),
              '\nshown',
              deps.dialogs.texts().slice(-4),
            );
          }
          return `step ${step} (${line}): the bytes of ${lost.join(', ')} are nowhere now`;
        }
      }
    }
    // Nothing below a folder named .git (any letter case, anywhere) was written, removed or made by
    // the step: no file or folder there appeared, went or changed its bytes (P1.1 rule 2). No step
    // of this test writes below .git on its own (save and program never pick such a path).
    const gitAfter = await belowGit(raw);
    const gitChanges = [...new Set([...gitBefore.keys(), ...gitAfter.keys()])].filter(
      (p) => gitBefore.get(p) !== gitAfter.get(p),
    );
    if (gitChanges.length > 0) {
      model.violations.push(`(P1.1 rule 2) the step changed below a .git folder: ${gitChanges.sort().join(', ')}`);
    }
    const violations = await checkHistoryInvariants(historyDatabaseOf(store as HistoryService), raw, model);
    if (violations.length > 0) return `step ${step} (${line}): ${violations.join('; ')}`;
    now += 1000;
  }
  return null;
}

describe('the Files panel keeps the seven properties (P3.3.1; P5 N5, last acceptance item)', () => {
  it(`${SEEDS} seeds x ${STEPS} steps of bulk delete, move, copy, rename and undo pass checkHistoryInvariants`, async () => {
    const started = Date.now();
    const stats: Stats = {};
    const failures: string[] = [];
    for (let seed = FIRST; seed < FIRST + SEEDS; seed++) {
      const trace: string[] = [];
      const failure = await runSeed(seed, trace, stats);
      if (ONE !== null) console.log(trace.join('\n'));
      if (failure) {
        failures.push(
          [
            `seed ${seed}: ${failure}`,
            `run it alone: EASY68K_N5_SEED=${seed} npx vitest run src/features/files/files-model.test.ts`,
            ...trace.slice(-15).map((t) => `  ${t}`),
          ].join('\n'),
        );
        if (failures.length >= 3) break;
      }
    }
    console.log(
      `files model: ${SEEDS} seeds x ${STEPS} steps in ${((Date.now() - started) / 1000).toFixed(1)} s; ` +
        Object.entries(stats)
          .sort()
          .map(([k, v]) => `${k} ${v}`)
          .join(', '),
    );
    expect(failures.join('\n\n')).toBe('');
  }, 3_600_000);
});
