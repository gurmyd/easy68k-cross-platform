// The Files panel (ARCHITECTURE.md 2.2): the browser store ("My Programs") as a tree, and the
// folder opened through the File System Access API if any. Double-click opens. Its strip offers
// New Folder..., Import..., Export... and Delete; the context menu adds Open and Rename....
// The tree's state and keyboard rules are in tree-model.ts, the actions in actions.ts.
// Owner: FS1.

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { AppContext, VPath } from '../../contracts';
import { splitVPath } from '../../core/paths/winpath';
import { onStorageStateChange, storageProblem } from '../../fs/browser-backend';
import { useAppContext } from '../../state/context';
import { ContextMenu, Icon, IconButton, Menu, Toolbar, type MenuEntry } from '../../ui/components';
import { deletePath, exportPath, folderFor, importInto, newFolder, renamePath } from './actions';
import { downloadBytes, importItemsOf, pickFiles } from './browser-io';
import { BROWSER_ROOT, locations } from './store';
import { FilesTreeModel, type TreeRow } from './tree-model';
import './files.css';

/** Asks the panel of this window to show a path (after an import, Help > Examples...). */
const revealRequests = new WeakMap<AppContext, (path: VPath) => void>();
export function revealInFilesPanel(ctx: AppContext, path: VPath): boolean {
  const reveal = revealRequests.get(ctx);
  if (!reveal) return false;
  reveal(path);
  return true;
}

function rowId(base: string, path: VPath): string {
  return `${base}-${encodeURIComponent(path).replace(/%/g, '_')}`;
}

export function FilesPanel() {
  const ctx = useAppContext();
  const [model, setModel] = useState<FilesTreeModel | null>(null);
  const [, setVersion] = useState(0);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [importAt, setImportAt] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const idBase = useRef(`e68-files-${Math.random().toString(36).slice(2, 8)}`).current;

  useEffect(() => {
    const created = new FilesTreeModel(ctx.vfs);
    setModel(created);
    const stop = created.subscribe(() => setVersion((v) => v + 1));
    revealRequests.set(ctx, (path) => void created.reveal(path));
    return () => {
      stop();
      created.dispose();
      if (revealRequests.get(ctx)) revealRequests.delete(ctx);
    };
  }, [ctx]);

  const browser = ctx.vfs.backends().find((backend) => backend.mount === 'browser');
  // A store still opening at start says so until it has opened or given up.
  useEffect(() => onStorageStateChange(browser, () => setVersion((v) => v + 1)), [browser]);
  const problem = storageProblem(browser);
  const rows = model?.rows() ?? [];
  const selected = model?.selectedRow() ?? null;
  const fallbackDir = locations(ctx.vfs)[0]?.root ?? BROWSER_ROOT;

  const open = (row: TreeRow) => {
    if (row.kind === 'file') void ctx.documents.open(row.path);
    else void model?.toggle(row.path);
  };

  const target = () => model?.selected ?? null;

  const doImport = (folder: boolean) => {
    // The chooser must open inside the click: start it before anything is awaited.
    const picking = pickFiles({ multiple: true, folder });
    void (async () => {
      const files = await picking;
      if (!files) return;
      const dir = await folderFor(ctx, target(), fallbackDir);
      const result = await importInto(ctx, dir, importItemsOf(files));
      if (result && model) await model.reveal(result.written[0] ?? dir);
    })();
  };
  const doExport = () => {
    const path = target() ?? fallbackDir;
    void exportPath(ctx, path, (name, bytes) => downloadBytes(name, bytes));
  };
  const doDelete = () => {
    const path = target();
    if (path) void deletePath(ctx, path);
  };
  const doNewFolder = () => {
    void (async () => {
      const parent = await folderFor(ctx, target(), fallbackDir);
      const created = await newFolder(ctx, parent);
      if (created && model) await model.reveal(created);
      treeRef.current?.focus();
    })();
  };
  const doRename = () => {
    const path = target();
    if (!path) return;
    void (async () => {
      const renamed = await renamePath(ctx, path);
      if (renamed && model) await model.reveal(renamed);
      treeRef.current?.focus();
    })();
  };

  const isStoreRoot = selected?.kind === 'root';
  const contextItems: MenuEntry[] = [
    {
      type: 'item',
      id: 'open',
      caption: '&Open',
      disabled: selected?.kind !== 'file',
      onSelect: () => selected && open(selected),
    },
    { type: 'separator' },
    { type: 'item', id: 'newFolder', caption: 'New &Folder...', onSelect: doNewFolder },
    { type: 'item', id: 'importFiles', caption: '&Import Files...', onSelect: () => doImport(false) },
    { type: 'item', id: 'importFolder', caption: 'Import Fol&der...', onSelect: () => doImport(true) },
    { type: 'item', id: 'export', caption: '&Export...', onSelect: doExport },
    { type: 'separator' },
    {
      type: 'item',
      id: 'rename',
      caption: '&Rename...',
      shortcut: 'F2',
      disabled: !selected || isStoreRoot,
      onSelect: doRename,
    },
    {
      type: 'item',
      id: 'delete',
      caption: 'De&lete',
      shortcut: 'Del',
      disabled: !selected || isStoreRoot,
      onSelect: doDelete,
    },
  ];
  const importItems: MenuEntry[] = [
    { type: 'item', id: 'importFiles', caption: '&Files or .zip...', onSelect: () => doImport(false) },
    { type: 'item', id: 'importFolder', caption: 'F&older...', onSelect: () => doImport(true) },
  ];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!model || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Delete') {
      event.preventDefault();
      doDelete();
      return;
    }
    if (event.key === 'F2') {
      event.preventDefault();
      doRename();
      return;
    }
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault();
      const element = selected ? document.getElementById(rowId(idBase, selected.path)) : treeRef.current;
      const box = element?.getBoundingClientRect();
      setMenuAt(box ? { x: box.left + 16, y: box.bottom } : { x: 0, y: 0 });
      return;
    }
    if (event.shiftKey) return;
    const action = model.keyAction(event.key);
    if (!action) return;
    event.preventDefault();
    if (action.kind === 'select') model.select(action.path);
    else if (action.kind === 'toggle') void model.toggle(action.path);
    else {
      const row = rows.find((r) => r.path === action.path);
      if (row) open(row);
    }
  };

  // Keep the selected row in view.
  useEffect(() => {
    if (!selected) return;
    document.getElementById(rowId(idBase, selected.path))?.scrollIntoView({ block: 'nearest' });
  }, [selected, idBase]);

  return (
    <div className="e68-files">
      <Toolbar label="Files" className="e68-files__strip">
        <IconButton icon="plus" size="small" label="New Folder..." onClick={doNewFolder} />
        <IconButton
          ref={importButton}
          icon="arrow-down"
          size="small"
          label="Import..."
          aria-haspopup="menu"
          aria-expanded={importAt !== null}
          onClick={() => {
            const box = importButton.current?.getBoundingClientRect();
            if (box) setImportAt({ x: box.left, y: box.top, width: box.width, height: box.height });
          }}
        />
        <IconButton icon="external" size="small" label="Export..." onClick={doExport} />
        <IconButton icon="trash" size="small" label="Delete" disabled={!selected || isStoreRoot} onClick={doDelete} />
      </Toolbar>
      {importAt && (
        <Menu
          items={importItems}
          label="Import"
          anchor={importAt}
          initialFocus="first"
          onSelect={(entry) => {
            setImportAt(null);
            entry.onSelect?.();
          }}
          onClose={() => {
            setImportAt(null);
            importButton.current?.focus();
          }}
        />
      )}
      {problem && (
        <p role="alert" className="e68-files__problem">
          <Icon name="warning" size={14} />
          <span>{problem}</span>
        </p>
      )}
      <div
        ref={treeRef}
        role="tree"
        aria-label="Files"
        tabIndex={0}
        data-e68-panel-focus=""
        aria-activedescendant={selected ? rowId(idBase, selected.path) : undefined}
        className="e68-files__tree"
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (model && !model.selected && rows[0]) model.select(rows[0].path);
        }}
        onContextMenu={(event: MouseEvent<HTMLDivElement>) => {
          event.preventDefault();
          setMenuAt({ x: event.clientX, y: event.clientY });
        }}
      >
        {rows.map((row) => (
          <div
            key={row.path}
            id={rowId(idBase, row.path)}
            role="treeitem"
            aria-level={row.depth}
            aria-expanded={row.kind === 'file' ? undefined : row.expanded}
            aria-selected={row.path === selected?.path}
            title={row.kind === 'root' ? row.name : splitVPath(row.path).rel}
            className={`e68-files__row e68-files__row--${row.kind}`}
            style={{ paddingInlineStart: `calc(var(--sp-1) + ${(row.depth - 1) * 14}px)` }}
            onPointerDown={(event) => {
              if (event.button !== 0 && event.button !== 2) return;
              model?.select(row.path);
            }}
            onClick={(event) => {
              // The twisty opens and closes without a double-click.
              if ((event.target as Element).closest('.e68-files__twisty') && row.kind !== 'file')
                void model?.toggle(row.path);
            }}
            onDoubleClick={() => open(row)}
          >
            <span className="e68-files__twisty" aria-hidden="true">
              {row.kind !== 'file' && <Icon name={row.expanded ? 'chevron-down' : 'chevron-right'} size={12} />}
            </span>
            <Icon name={row.kind === 'file' ? 'file' : 'folder'} size={14} />
            <span className="e68-files__name">{row.name}</span>
            {row.error && <span className="e68-files__error"> ({row.error})</span>}
          </div>
        ))}
      </div>
      <ContextMenu items={contextItems} label="Files" at={menuAt} onClose={() => setMenuAt(null)} />
    </div>
  );
}
