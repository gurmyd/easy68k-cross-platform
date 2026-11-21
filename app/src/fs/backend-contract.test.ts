// The contract suites catch broken implementations (a suite that passes everything proves nothing).

import { describe, expect, it } from 'vitest';
import type { Bytes, VPath } from '../contracts';
import { BACKEND_CONTRACT_CASES, ContractFailure, SYNC_FILES_CONTRACT_CASES } from './backend-contract';
import { MemoryBackend } from './memory-backend';
import { MemorySyncFiles } from './sync/memory';

async function failures(make: () => MemoryBackend): Promise<string[]> {
  const failed: string[] = [];
  for (const c of BACKEND_CONTRACT_CASES) {
    try {
      await c.run(make());
    } catch (error) {
      expect(error).toBeInstanceOf(ContractFailure);
      failed.push(c.name);
    }
  }
  return failed;
}

describe('the backend contract detects defects', () => {
  it('a backend that returns its internal array', async () => {
    class Aliasing extends MemoryBackend {
      private readonly kept = new Map<string, Bytes>();
      override async writeFile(rel: string, data: Bytes) {
        this.kept.set(rel, data);
        return super.writeFile(rel, data);
      }
      override async readFile(rel: string) {
        return this.kept.get(rel) ?? super.readFile(rel);
      }
    }
    expect(await failures(() => new Aliasing())).toContain('the backend keeps its own copy of the bytes');
  });

  it('a backend whose appendFile replaces the file', async () => {
    class Replacing extends MemoryBackend {
      override appendFile(rel: string, data: Bytes) {
        return this.writeFile(rel, data);
      }
    }
    const failed = await failures(() => new Replacing());
    expect(failed).toContain('appendFile creates a missing file and appends in call order');
    expect(failed).toContain('many small appends keep every byte');
  });

  it('a backend that removes missing files silently', async () => {
    class Lenient extends MemoryBackend {
      override async remove(rel: string) {
        if ((await this.stat(rel)) === null) return;
        return super.remove(rel);
      }
    }
    expect(await failures(() => new Lenient())).toEqual(['missing paths are rejected with not-found']);
  });
});

describe('the SyncFiles contract detects defects', () => {
  it('a view that does not zero-fill gaps and ignores case', async () => {
    class Sloppy extends MemorySyncFiles {
      override resolve(dir: VPath, name: string): VPath | null {
        return `${dir}/${name}`;
      }
    }
    const failed: string[] = [];
    for (const c of SYNC_FILES_CONTRACT_CASES) {
      try {
        await c.run(new Sloppy(), '/memory/t');
      } catch {
        failed.push(c.name);
      }
    }
    expect(failed).toContain('resolve follows the Windows name rules');
  });
});
