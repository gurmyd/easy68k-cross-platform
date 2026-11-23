// The layout of the Files panel's sources: every import comes before the first other statement, and
// the texts of New Folder... live in texts.ts (review of the stage's first gate: a text constant had
// been declared between the imports of actions.ts).

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NEW_FOLDER_INITIAL_NAME, NEW_FOLDER_TITLE } from './texts';

const HERE = dirname(fileURLToPath(import.meta.url));

function sources(): string[] {
  return readdirSync(HERE)
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .sort();
}

/**
 * The imports of a file that come after its first top-level statement that is not an import. A
 * top-level statement starts in column 0 (Prettier's layout); the lines of a multi-line import are
 * indented or start with `}`.
 */
function lateImports(name: string): string[] {
  const lines = readFileSync(join(HERE, name), 'utf8').split(/\r?\n/);
  const late: string[] = [];
  let other = false;
  lines.forEach((line, index) => {
    if (/^import[\s{]/.test(line)) {
      if (other) late.push(`${name}:${index + 1}`);
    } else if (/^(export|const|let|var|function|async|class|type|interface|enum|declare)\b/.test(line)) {
      other = true;
    }
  });
  return late;
}

describe('the sources of features/files', () => {
  it('put every import before the first other statement', () => {
    const names = sources();
    expect(names).toContain('actions.ts');
    expect(names.flatMap(lateImports)).toEqual([]);
  });

  it('take the texts of New Folder... from texts.ts', () => {
    expect(NEW_FOLDER_TITLE).toBe('New Folder');
    expect(NEW_FOLDER_INITIAL_NAME).toBe('New Folder');
    const actions = readFileSync(join(HERE, 'actions.ts'), 'utf8');
    expect(actions.match(/'New Folder'/g) ?? []).toEqual([]);
  });
});
