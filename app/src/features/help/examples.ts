// Help > Examples...: the ten official example programs and their sounds (ARCHITECTURE.md 5.8).
// Owner: H1.
//
// The files are served from app/public/examples (tools/import-examples.mjs) with manifest.json, the
// sorted list of { name, size }. Web: they are copied into /browser/Examples/ when that folder is
// missing (a folder the user has is never overwritten) and the Files panel is shown. Desktop: the
// user chooses a folder, the files are copied there and the Open dialog is shown in it.
//
// Plain functions over the Vfs and a fetch function, tested under Node.

import type { Bytes, VPath, Vfs } from '../../contracts';

export interface ExampleFile {
  name: string;
  size: number;
}

/** Where the web app keeps the examples. */
export const WEB_EXAMPLES_DIR: VPath = '/browser/Examples';

export interface ExampleFetch {
  (
    url: string,
  ): Promise<{ ok: boolean; status: number; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;
}

/** The file list of the shipped examples. */
export async function loadExampleList(base: string, fetchFn: ExampleFetch): Promise<ExampleFile[]> {
  const response = await fetchFn(`${base}examples/manifest.json`);
  if (!response.ok) throw new Error(`The list of examples could not be read (HTTP ${response.status})`);
  const manifest = (await response.json()) as { files?: ExampleFile[] };
  if (!Array.isArray(manifest.files)) throw new Error('The list of examples is not in the expected form');
  return manifest.files;
}

/** Copies the shipped files into `dir`, byte for byte. Returns the paths written. */
export async function copyExamples(
  vfs: Pick<Vfs, 'writeFile'>,
  dir: VPath,
  files: readonly ExampleFile[],
  base: string,
  fetchFn: ExampleFetch,
): Promise<VPath[]> {
  const written: VPath[] = [];
  for (const file of files) {
    const response = await fetchFn(`${base}examples/${encodeURIComponent(file.name)}`);
    if (!response.ok) throw new Error(`${file.name} could not be read (HTTP ${response.status})`);
    const bytes: Bytes = new Uint8Array(await response.arrayBuffer());
    const path = `${dir}/${file.name}`;
    await vfs.writeFile(path, bytes);
    written.push(path);
  }
  return written;
}

/** Whether the web examples folder exists. */
export async function examplesFolderExists(vfs: Pick<Vfs, 'stat'>): Promise<boolean> {
  return (await vfs.stat(WEB_EXAMPLES_DIR)) !== null;
}
