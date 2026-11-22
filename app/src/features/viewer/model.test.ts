// The viewer service without React (ARCHITECTURE-PLUS P3.4.2, P4.4), against a fake dock.

import { describe, expect, it } from 'vitest';
import type { PlusSettings, VPath } from '../../contracts';
import { createViewerModel, type ViewerHandle, type ViewerModelDeps } from './model';

const text = (value: string) => Uint8Array.from(value, (ch) => ch.charCodeAt(0));
const PDF = text('%PDF-1.4\n%%EOF\n');
const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0);

interface TransientSpec {
  id: `viewer:${number}`;
  title: string;
  tooltip: string;
  render(): unknown;
  onClose(): void;
}

/**
 * A dock that accepts transient panels and, like N1's controller (P4.4), queues those opened
 * before it is attached and opens them when `attach()` is called.
 */
function fakeDock(options: { accepts?: boolean; attached?: boolean } = {}) {
  let accepts = options.accepts ?? true;
  let attached = options.attached ?? true;
  const queued: TransientSpec[] = [];
  const open = new Map<string, TransientSpec>();
  const selected: string[] = [];
  return {
    open,
    selected,
    queued,
    setAccepts: (on: boolean) => void (accepts = on),
    attach() {
      attached = true;
      for (const spec of queued.splice(0)) open.set(spec.id, spec);
    },
    controller: {
      acceptsTransient: () => accepts,
      openTransient: (spec: TransientSpec) => {
        if (!accepts) return false;
        if (attached) open.set(spec.id, spec);
        else queued.push(spec);
        return true;
      },
      selectTransient: (id: string) => {
        if (!open.has(id)) return false;
        selected.push(id);
        return true;
      },
      closeTransient: (id: string) => {
        const spec = open.get(id);
        if (!spec) return;
        open.delete(id);
        spec.onClose();
      },
    },
  };
}

function setup(options: { plus?: PlusSettings; accepts?: boolean; attached?: boolean; desktop?: boolean } = {}) {
  const dock = fakeDock(options);
  let plus = options.plus ?? { viewer: true, history: true };
  const created: { url: string; type: string; bytes: number[] }[] = [];
  const revoked: string[] = [];
  const openedAsText: string[] = [];
  const downloads: { name: string; bytes: number[] }[] = [];
  const rendered: ViewerHandle[] = [];
  let next = 0;
  const deps: ViewerModelDeps = {
    plus: () => plus,
    dock: () => dock.controller,
    urls: {
      create: (bytes, type) => {
        const url = `blob:test/${++next}`;
        created.push({ url, type, bytes: [...bytes] });
        return url;
      },
      revoke: (url) => void revoked.push(url),
    },
    nameOf: (path) => path.slice(path.lastIndexOf('/') + 1),
    tooltipOf: (path) => `place of ${path}`,
    render: (handle) => {
      rendered.push(handle);
      return null;
    },
    openAsText: async (path) => void openedAsText.push(path),
    download: options.desktop ? null : (name, bytes) => void downloads.push({ name, bytes: [...bytes] }),
    desktop: options.desktop ?? false,
    pdfViewerEnabled: () => true,
  };
  const model = createViewerModel(deps);
  return {
    model,
    dock,
    created,
    revoked,
    openedAsText,
    downloads,
    rendered,
    setPlus: (value: PlusSettings) => void (plus = value),
  };
}

const handleOf = (t: ReturnType<typeof setup>, path: string) => {
  const handle = t.model.open().find((viewer) => viewer.snapshot().path === path);
  if (!handle) throw new Error(`no viewer of ${path}`);
  return handle;
};

describe('wants (P3.4.1, P4.4)', () => {
  it('true for a PDF, a picture and a binary file while the switch is on and the dock accepts transient panels', () => {
    const t = setup();
    expect(t.model.wants('/browser/r.pdf', PDF)).toBe(true);
    expect(t.model.wants('/browser/p.png', PNG)).toBe(true);
    expect(t.model.wants('/browser/d.bin', Uint8Array.of(1, 0, 2))).toBe(true);
    expect(t.model.wants('/browser/p.X68', Uint8Array.of(1, 0, 2))).toBe(false);
    expect(t.model.wants('/browser/notes.txt', text('hello'))).toBe(false);
  });

  it('false for everything with the viewer switch off', () => {
    const t = setup({ plus: { viewer: false, history: true } });
    expect(t.model.wants('/browser/r.pdf', PDF)).toBe(false);
    expect(t.model.wants('/browser/p.png', PNG)).toBe(false);
    expect(t.model.wants('/browser/d.bin', Uint8Array.of(0))).toBe(false);
    t.setPlus({ viewer: true, history: false });
    expect(t.model.wants('/browser/r.pdf', PDF)).toBe(true);
  });

  it("false when acceptsTransient() is false (N0's stub, tests)", () => {
    const t = setup({ accepts: false });
    expect(t.model.wants('/browser/r.pdf', PDF)).toBe(false);
    expect(t.model.wants('/browser/p.png', PNG)).toBe(false);
  });
});

describe('show (P3.4.2)', () => {
  it('opens viewer:<n> titled with the name, the place text as tool-tip, a blob of the explicit type', () => {
    const t = setup();
    t.model.show('/browser/docs/report.pdf', PDF);
    t.model.show('/browser/pic.svg', text('<svg/>'));
    expect([...t.dock.open.values()].map(({ id, title, tooltip }) => ({ id, title, tooltip }))).toEqual([
      { id: 'viewer:1', title: 'report.pdf', tooltip: 'place of /browser/docs/report.pdf' },
      { id: 'viewer:2', title: 'pic.svg', tooltip: 'place of /browser/pic.svg' },
    ]);
    expect(t.created).toEqual([
      { url: 'blob:test/1', type: 'application/pdf', bytes: [...PDF] },
      { url: 'blob:test/2', type: 'image/svg+xml', bytes: [...text('<svg/>')] },
    ]);
    const pdf = handleOf(t, '/browser/docs/report.pdf').snapshot();
    expect(pdf).toMatchObject({ kind: 'pdf', name: 'report.pdf', url: 'blob:test/1', type: 'application/pdf' });
    expect([...pdf.bytes]).toEqual([...PDF]);
  });

  it('a notice makes no blob URL', () => {
    const t = setup();
    t.model.show('/browser/data.bin', Uint8Array.of(1, 0));
    expect(handleOf(t, '/browser/data.bin').snapshot()).toMatchObject({ kind: 'notice', url: null });
    expect(t.created).toEqual([]);
  });

  it('a second open of the same path selects its tab; with changed bytes it shows them and revokes the old URL', () => {
    const t = setup();
    t.model.show('/browser/r.pdf', PDF);
    const handle = handleOf(t, '/browser/r.pdf');
    let changes = 0;
    handle.subscribe(() => void changes++);
    t.model.show('/browser/r.pdf', PDF);
    expect(t.dock.selected).toEqual(['viewer:1']);
    expect(t.dock.open.size).toBe(1);
    expect(changes).toBe(0);
    expect(t.created).toHaveLength(1);
    const newer = text('%PDF-1.7\n');
    t.model.show('/browser/r.pdf', newer);
    expect(t.dock.selected).toEqual(['viewer:1', 'viewer:1']);
    expect(changes).toBe(1);
    expect(handle.snapshot().url).toBe('blob:test/2');
    expect([...handle.snapshot().bytes]).toEqual([...newer]);
    expect(t.revoked).toEqual(['blob:test/1']);
  });

  it('the blob URL is revoked when the viewer closes, by its x, closeTransient or a mode change alike', () => {
    const t = setup();
    t.model.show('/browser/r.pdf', PDF);
    t.model.show('/browser/p.png', PNG);
    t.dock.controller.closeTransient('viewer:1');
    expect(t.revoked).toEqual(['blob:test/1']);
    expect(t.model.open().map((viewer) => viewer.id)).toEqual(['viewer:2']);
    // After the close, opening the path again opens a new viewer (and reads the bytes again).
    t.model.show('/browser/r.pdf', PDF);
    expect([...t.dock.open.keys()]).toEqual(['viewer:2', 'viewer:3']);
    t.model.closeAll();
    expect(t.revoked).toEqual(['blob:test/1', 'blob:test/2', 'blob:test/3']);
    expect(t.dock.open.size).toBe(0);
  });

  it('a viewer opened before the dock is attached is queued and shown once it attaches', () => {
    const t = setup({ attached: false });
    expect(t.model.wants('/browser/r.pdf', PDF)).toBe(true);
    t.model.show('/browser/r.pdf', PDF);
    expect(t.dock.open.size).toBe(0);
    expect(t.dock.queued.map((spec) => spec.id)).toEqual(['viewer:1']);
    t.dock.attach();
    expect([...t.dock.open.keys()]).toEqual(['viewer:1']);
    t.dock.open.get('viewer:1')!.render();
    expect(t.rendered.map((handle) => handle.snapshot().path)).toEqual(['/browser/r.pdf']);
  });

  it('when the dock refuses the tab, the file opens as text and nothing is kept', () => {
    const t = setup();
    t.dock.setAccepts(false);
    t.model.show('/browser/r.pdf', PDF);
    expect(t.openedAsText).toEqual(['/browser/r.pdf']);
    expect(t.model.open()).toEqual([]);
    expect(t.revoked).toEqual(['blob:test/1']);
  });
});

describe("the strip's actions (P3.4.2)", () => {
  it('Open as Text opens the file with { asText: true } and closes the viewer', async () => {
    const t = setup();
    t.model.show('/browser/r.pdf', PDF);
    await handleOf(t, '/browser/r.pdf').actions.openAsText();
    expect(t.openedAsText).toEqual(['/browser/r.pdf']);
    expect(t.dock.open.size).toBe(0);
    expect(t.revoked).toEqual(['blob:test/1']);
  });

  it('Export downloads the name and the bytes shown; the desktop app has no Export', () => {
    const t = setup();
    t.model.show('/browser/p.png', PNG);
    const handle = handleOf(t, '/browser/p.png');
    expect(handle.actions.desktop).toBe(false);
    handle.actions.exportFile?.();
    expect(t.downloads).toEqual([{ name: 'p.png', bytes: [...PNG] }]);

    const desktop = setup({ desktop: true });
    desktop.model.show('/disk/Users/me/p.png' as VPath, PNG);
    const onDesktop = handleOf(desktop, '/disk/Users/me/p.png');
    expect(onDesktop.actions.desktop).toBe(true);
    expect(onDesktop.actions.exportFile).toBeUndefined();
  });
});
