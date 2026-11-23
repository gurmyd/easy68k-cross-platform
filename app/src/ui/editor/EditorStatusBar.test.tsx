// Editor mode's window status bar shows the place text of ARCHITECTURE-PLUS P3.2.5 (package N8):
// for each store, by the pure function and as markup of the real component (server rendering under
// Node, no DOM).

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppContext, FileSystemBackend, VPath } from '../../contracts';
import { DocumentManager } from '../../core/documents/service';
import { LINKED_SUFFIX, folderSuffix } from '../../core/places/texts';
import { folderLabel } from '../../fs/fsaccess-backend';
import { MemoryBackend } from '../../fs/memory-backend';
import { ApplicationProvider } from '../../state/context';
import { createFakePlatform, createTestApplication, type TestApplication } from '../../state/testing';
import { EditorWindowStatus, windowPlaceText } from './EditorStatusBar';

type Labels = Pick<FileSystemBackend, 'mount' | 'label' | 'kind'>;
const MY_PROGRAMS: Labels = { mount: 'browser', label: 'My Programs', kind: 'browser' };
const LINKED: Labels = { mount: 'linked', label: 'Linked files', kind: 'fsaccess' };
// The label FS2's FolderBackend really gives an opened folder named Lab (Folder: Lab); the status bar
// shows P3.2.5's text, without the "Folder: " (verify round 1 of N8; docs/requests/N8-folder-place-text.md).
const FOLDER: Labels = { mount: 'folder', label: folderLabel('Lab'), kind: 'fsaccess' };
const DISK: Labels = { mount: 'disk', label: 'This computer', kind: 'disk' };
const ALL = [MY_PROGRAMS, LINKED, FOLDER, DISK];

const doc = (path: VPath | null, name = 'prog.X68') => ({ path, name });

describe('windowPlaceText: the status bar text for each store', () => {
  it('My Programs', () => {
    expect(windowPlaceText(ALL, doc('/browser/demo/prog.X68'), 'web')).toBe('My Programs/demo/prog.X68');
  });
  it('a linked file: its name, on this computer, edited in place; never /linked/<id>', () => {
    const text = windowPlaceText(ALL, doc('/linked/21d878e9/lab1.X68', 'lab1.X68'), 'web');
    expect(text).toBe('lab1.X68 - on this computer, edited in place');
    expect(text).toBe(`lab1.X68${LINKED_SUFFIX}`);
    // Also when the linked store is not mounted (a document restored from a draft).
    expect(windowPlaceText([MY_PROGRAMS], doc('/linked/21d878e9/lab1.X68', 'lab1.X68'), 'web')).toBe(
      'lab1.X68 - on this computer, edited in place',
    );
  });
  it('the opened folder, by the label its backend really has', () => {
    expect(FOLDER.label).toBe('Folder: Lab');
    const text = windowPlaceText(ALL, doc('/folder/prog.X68'), 'web');
    expect(text).toBe('Lab/prog.X68 - in the folder "Lab" on this computer');
    expect(text).toBe(`Lab/prog.X68${folderSuffix('Lab')}`);
  });
  it('the desktop app: the real path', () => {
    expect(windowPlaceText(ALL, doc('/disk/Users/me/lab/prog.X68'), 'desktop')).toBe('/Users/me/lab/prog.X68');
    expect(windowPlaceText(ALL, doc('/disk/C:/Users/me/prog.X68'), 'desktop')).toBe('C:\\Users\\me\\prog.X68');
  });
  it('a store of tests (/memory) and a document without a file', () => {
    expect(windowPlaceText([{ mount: 'memory', label: 'Memory', kind: 'memory' }], doc('/memory/a/b.X68'), 'web')).toBe(
      'Memory/a/b.X68',
    );
    expect(windowPlaceText(ALL, doc(null, 'untitled1.x68'), 'web')).toBe('untitled1.x68');
  });
});

describe('EditorWindowStatus markup', () => {
  const apps: TestApplication[] = [];
  afterEach(() => {
    for (const app of apps.splice(0)) app.dispose();
  });

  async function shown(
    backends: MemoryBackend[],
    path: VPath | null,
    kind: 'web' | 'desktop' = 'web',
  ): Promise<string> {
    const app = createTestApplication({
      backends,
      platform: createFakePlatform({ kind }),
      services: {
        createDocumentService: (ctx: AppContext) =>
          new DocumentManager({
            store: ctx.store,
            settings: ctx.settings,
            dialogs: ctx.dialogs,
            vfs: ctx.vfs,
            fileDialogs: ctx.fileDialogs,
          }),
      },
    });
    apps.push(app);
    if (path === null) app.ctx.documents.newSource();
    else {
      await app.ctx.vfs.writeFile(path, Uint8Array.of(0x2a, 0x0d, 0x0a));
      expect(await app.ctx.documents.open(path)).not.toBeNull();
    }
    const html = renderToStaticMarkup(
      <ApplicationProvider app={app}>
        <EditorWindowStatus />
      </ApplicationProvider>,
    );
    const match = /data-e68-editor-status="path">([^<]*)</.exec(html);
    return (match?.[1] ?? '').replaceAll('&quot;', '"');
  }

  const store = (options: ConstructorParameters<typeof MemoryBackend>[0]) => new MemoryBackend(options);

  it('shows the place text of the active document in each store, never the internal path', async () => {
    const browser = () => store({ mount: 'browser', kind: 'browser', label: 'My Programs' });
    expect(await shown([browser()], '/browser/demo/prog.X68')).toBe('My Programs/demo/prog.X68');
    expect(
      await shown(
        [browser(), store({ mount: 'linked', kind: 'fsaccess', label: 'Linked files' })],
        '/linked/0a1b2c3d/lab1.X68',
      ),
    ).toBe('lab1.X68 - on this computer, edited in place');
    expect(
      await shown(
        [browser(), store({ mount: 'folder', kind: 'fsaccess', label: folderLabel('Lab') })],
        '/folder/prog.X68',
      ),
    ).toBe('Lab/prog.X68 - in the folder "Lab" on this computer');
    expect(
      await shown(
        [browser(), store({ mount: 'disk', kind: 'disk', label: 'This computer' })],
        '/disk/Users/me/prog.X68',
        'desktop',
      ),
    ).toBe('/Users/me/prog.X68');
    expect(await shown([browser()], null)).toBe('untitled1.x68');
  }, 30_000);
});
