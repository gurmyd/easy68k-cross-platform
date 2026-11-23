// The viewer service in a whole application under Node (ARCHITECTURE-PLUS P3.4, P4.4): the real
// document service, the real viewer service and the window's real dock controller (state/dock.ts:
// N0's stub, which accepts no transient panel, until N1's controller is in the tree).

import { describe, expect, it } from 'vitest';
import type { AppContext, VPath } from '../../contracts';
import { withPlus } from '../../core/plus/settings';
import { MemoryBackend } from '../../fs/memory-backend';
import { dockOf } from '../../state/dock';
import { createFakePlatform, createTestApplication } from '../../state/testing';
import { createDocumentService, createDocumentsFeature } from '../documents';
import { feature as viewerFeature } from './index';
import { createViewerService, viewerModelOf } from './service';

const text = (value: string) => Uint8Array.from(value, (ch) => ch.charCodeAt(0));
const PDF = text('%PDF-1.4\n%%EOF\n');

/** `files`: written into the browser store before the application starts (rel path -> bytes). */
async function setup(startupFile: VPath | null = null, files: Record<string, Uint8Array> = {}) {
  const revoked: string[] = [];
  let next = 0;
  const backend = new MemoryBackend({ mount: 'browser', kind: 'memory', label: 'My Programs' });
  for (const [rel, data] of Object.entries(files)) await backend.writeFile(rel, data);
  const app = createTestApplication({
    backends: [backend],
    platform: createFakePlatform({
      startupArgs: () => ({ file: startupFile, run: false, fullScreen: false, exceptions: false, bitField: false }),
    }),
    features: [createDocumentsFeature({ draftStore: () => null }), viewerFeature],
    services: {
      createDocumentService,
      createViewerService: (ctx: AppContext) =>
        createViewerService(ctx, {
          urls: { create: () => `blob:test/${++next}`, revoke: (url) => void revoked.push(url) },
          download: () => {},
          pdfViewerEnabled: () => true,
        }),
    },
  });
  return { app, ctx: app.ctx, revoked };
}

/** Waits until `check` holds (the start-up open runs after init). */
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

describe('createViewerService in an application', () => {
  it('wants() follows the switch and the dock: false whenever acceptsTransient() is false', async () => {
    const { app, ctx } = await setup();
    const accepts = dockOf(ctx).acceptsTransient();
    expect(ctx.viewer).toBeDefined();
    expect(ctx.viewer!.wants('/browser/r.pdf', PDF)).toBe(accepts);
    expect(ctx.viewer!.wants('/browser/p.X68', PDF)).toBe(false);
    ctx.settings.update((current) => withPlus(current, { viewer: false }));
    expect(ctx.viewer!.wants('/browser/r.pdf', PDF)).toBe(false);
    app.dispose();
  });

  it('with the viewer switch off a PDF opens as text through the real document service', async () => {
    const { app, ctx } = await setup();
    ctx.settings.update((current) => withPlus(current, { viewer: false }));
    await ctx.vfs.writeFile('/browser/r.pdf', PDF);
    const doc = await ctx.documents.open('/browser/r.pdf');
    expect(doc).toMatchObject({ name: 'r.pdf', path: '/browser/r.pdf' });
    expect(viewerModelOf(ctx)?.open()).toEqual([]);
    app.dispose();
  });

  it('a start-up PDF: the Editor holds the template when the viewer takes it, the PDF as text when not', async () => {
    const { app, ctx } = await setup('/browser/a.pdf', { 'a.pdf': PDF });
    await until(() => ctx.store.getState().documents.items.length > 0);
    const docs = ctx.store.getState().documents.items.map((doc) => [doc.name, doc.path]);
    if (dockOf(ctx).acceptsTransient()) {
      // The dock queues the tab until the Editor dock attaches (N1, P4.4); the viewer exists now.
      expect(docs).toEqual([['untitled1.x68', null]]);
      expect(ctx.documents.text(ctx.documents.list()[0]!.id)).toBe(ctx.settings.get().editor.template);
      expect(
        viewerModelOf(ctx)
          ?.open()
          .map((viewer) => viewer.snapshot().path),
      ).toEqual(['/browser/a.pdf']);
    } else {
      // N0's stub dock: no viewer, so the start-up file opens as text, as in the original.
      expect(docs).toEqual([['a.pdf', '/browser/a.pdf']]);
    }
    app.dispose();
  });

  it('disposing the application closes the viewers and revokes their URLs', async () => {
    const { app, ctx, revoked } = await setup();
    const model = viewerModelOf(ctx)!;
    // Shown directly: with N0's stub dock the tab is refused and the file opens as text instead.
    await ctx.vfs.writeFile('/browser/r.pdf', PDF);
    model.show('/browser/r.pdf', PDF);
    const kept = model.open().length;
    app.dispose();
    expect(model.open()).toEqual([]);
    expect(revoked.length).toBe(1);
    expect(kept).toBe(dockOf(ctx).acceptsTransient() ? 1 : 0);
  });
});
