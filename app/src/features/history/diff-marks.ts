// Which lines of a comparison are deleted and which are inserted (ARCHITECTURE-PLUS P3.3.8): the
// marks of N4's own gutter, `-` for each deleted line and `+` for each inserted one, so that nothing
// depends on colour alone (main 2.11). Owner: N4.
//
// Pure; runs under Node. A chunk of @codemirror/merge (structurally: fromA, toA, fromB, toB) covers
// whole lines: `from` is the start of its first changed line, `to` one past the end of its last
// (it may point one past the end of the document); an empty side (`to` === `from`) has no lines.
// Side A is the earlier version (left, `-`), side B the file now (right, `+`).

/** The part of @codemirror/state's Text this module reads. */
export interface LineText {
  readonly length: number;
  lineAt(pos: number): { number: number };
}

/** The part of @codemirror/merge's Chunk this module reads. */
export interface ChunkRange {
  readonly fromA: number;
  readonly toA: number;
  readonly fromB: number;
  readonly toB: number;
}

/** The 1-based numbers of the lines that `from`..`to` covers in `doc` (none when it is empty). */
export function linesOf(doc: LineText, from: number, to: number): number[] {
  if (to <= from) return [];
  const first = doc.lineAt(Math.min(from, doc.length)).number;
  const last = doc.lineAt(Math.min(Math.max(from, to - 1), doc.length)).number;
  const out: number[] = [];
  for (let line = first; line <= last; line++) out.push(line);
  return out;
}

/** The lines of side A that are deleted and the lines of side B that are inserted. */
export function changedLines(
  chunks: readonly ChunkRange[],
  a: LineText,
  b: LineText,
): { deleted: ReadonlySet<number>; inserted: ReadonlySet<number> } {
  const deleted = new Set<number>();
  const inserted = new Set<number>();
  for (const chunk of chunks) {
    for (const line of linesOf(a, chunk.fromA, chunk.toA)) deleted.add(line);
    for (const line of linesOf(b, chunk.fromB, chunk.toB)) inserted.add(line);
  }
  return { deleted, inserted };
}

/** How many lines of side A a chunk deletes (the `-` marks beside a deleted block of the unified view). */
export function deletedLineCount(chunk: ChunkRange, a: LineText): number {
  return linesOf(a, chunk.fromA, chunk.toA).length;
}

/** The mark of a line: `-` deleted (side A), `+` inserted (side B). */
export const DELETED_MARK = '-';
export const INSERTED_MARK = '+';
