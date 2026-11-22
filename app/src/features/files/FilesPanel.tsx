// The Files panel (ARCHITECTURE.md 2.2; ARCHITECTURE-PLUS P3.2): the browser store ("My Programs")
// as a tree, the folder opened through the File System Access API if any, and the linked files
// ("Opened from this computer"). Double-click opens. Its strip offers New Folder..., Import...,
// Export, Delete and Trash...; the context menu adds Open, Move To..., Rename..., Earlier
// Versions... and Undo. Several rows can be selected (selection.ts) and dragged onto a folder
// (move.ts); a line at the bottom says how much is stored (StorageLine.tsx).
// The tree's state and keyboard rules are in tree-model.ts, the actions in actions.ts, bulk.ts,
// move.ts and undo.ts.
// Owner: FS1 > N5.

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { AppContext, VPath } from '../../contracts';
import { chordOf } from '../../commands/chords';
import { splitVPath } from '../../core/paths/winpath';
import { onStorageStateChange, storageProblem } from '../../fs/browser-backend';
import { useAppContext } from '../../state/context';
import { focusPanel } from '../../state/panels';
import { Button, ContextMenu, Icon, IconButton, Menu, Toolbar, type MenuEntry } from '../../ui/components';
import { exportPath, folderFor, importInto, newFolder, renamePath } from './actions';
import { deleteItems, exportCaption, type ExportRow } from './bulk';
import { downloadBytes, importItemsOf, pickFiles } from './browser-io';
import { pageEstimator } from './import-guard';
import {
  MOVE_TO_DIALOG_ID,
  dropFolderOf,
  movableItems,
  moveTargets,
  refusedTarget,
  transferItems,
  transferModeOf,
} from './move';
import type { MoveToDialogProps, MoveToDialogResult } from './MoveToDialog';
import { registerFilesRevealer, requestReveal } from './reveal';
import { focusAfterDelete, isToggleClick, ownKeysAttribute, ownedChords, selectionKeyOf } from './selection';
import { StorageLine } from './StorageLine';
import { BROWSER_ROOT, displayPath, locations } from './store';
import {
  STORAGE_NOTICE_DISMISS_CAPTION,
  STORAGE_NOTICE_EXPORT_CAPTION,
  STORAGE_NOTICE_IMPORT_CAPTION,
  STORAGE_NOTICE_LABEL,
  acknowledgeStorageNotice,
  markStorageNoticeSeen,
  onScreen,
  readNoticeEnvironment,
  storageNoticeAcknowledged,
  storageNoticeKind,
  storageNoticeText,
  storeEmptyAtStart,
  storeKindOf,
  type StorageNoticeKind,
} from './storage-notice';
import {
  EARLIER_VERSIONS_CAPTION,
  MOVE_TO_CAPTION,
  REMOVE_FROM_LIST_CAPTION,
  TRASH_BUTTON,
  copyTo,
  selectedCount,
  undoCaption,
} from './texts';
import { FilesTreeModel, type TreeRow } from './tree-model';
import { filesDeps, onUndoneFromToast, undoLast, undoStackOf } from './undo';
import './files.css';

/** The type of a drag of rows of the Files panel (never `Files`: the window's drop ignores it). */
export const FILES_DRAG_TYPE = 'application/x-e68-paths';
/** A folder row under the pointer for this long during a drag opens (P3.2.4). */
export const DRAG_EXPAND_MS = 800;

/** Asks the panel of this window to show a path (after an import, Help > Examples...). False if the
 *  panel is not mounted; app.files.toggle with { reveal } also waits for it to mount (reveal.ts). */
export function revealInFilesPanel(ctx: AppContext, path: VPath): boolean {
  return requestReveal(ctx, path);
}

/** How long the notice must be visible before it counts as seen (watchFirstWrite). */
const NOTICE_SEEN_AFTER_MS = 1000;

function rowId(base: string, path: VPath): string {
  return `${base}-${encodeURIComponent(path).replace(/%/g, '_')}`;
}

export function FilesPanel() {
  const ctx = useAppContext();
  const os = ctx.platform.os;
  const [model, setModel] = useState<FilesTreeModel | null>(null);
  const [, setVersion] = useState(0);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [importAt, setImportAt] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [dropOn, setDropOn] = useState<{ path: VPath; copy: string | null } | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const dragged = useRef<VPath[] | null>(null);
  const expandTimer = useRef<{ path: VPath; stop: () => void } | null>(null);
  const pendingClick = useRef<VPath | null>(null);
  const idBase = useRef(`e68-files-${Math.random().toString(36).slice(2, 8)}`).current;
  const deps = useRef(filesDeps(ctx)).current;
  const stack = undoStackOf(ctx);
  const undoKind = useSyncExternalStore(
    (listener) => stack.subscribe(listener),
    () => stack.kind(),
  );

  useEffect(() => {
    const created = new FilesTreeModel(ctx.vfs);
    setModel(created);
    const stop = created.subscribe(() => setVersion((v) => v + 1));
    const unregister = registerFilesRevealer(ctx, (path) => void created.reveal(path));
    // P3.3.10: Git or another program may have changed an opened folder while the window was away.
    const onWindowFocus = () => void created.windowFocused();
    window.addEventListener('focus', onWindowFocus);
    // A file opened "From this computer..." is linked without a change of the Vfs: its document
    // tells the tree (P3.2.5).
    const linkedPaths = () =>
      ctx.store
        .getState()
        .documents.items.map((doc) => doc.path)
        .filter((path): path is VPath => path !== null && path.startsWith('/linked/'));
    void created.linkedSeen(linkedPaths());
    const stopDocs = ctx.store.subscribe(() => void created.linkedSeen(linkedPaths()));
    // P3.2.7: after a toast's Undo the focus goes to the first row brought back.
    const stopUndone = onUndoneFromToast(ctx, (paths) => {
      void (async () => {
        const first = paths[0];
        if (first) {
          await created.reveal(first);
          treeRef.current?.focus();
        } else if (treeRef.current && created.selected) {
          treeRef.current.focus();
        } else {
          focusPanel(ctx, 'editor');
        }
      })();
    });
    return () => {
      stop();
      created.dispose();
      unregister();
      stopUndone();
      stopDocs();
      window.removeEventListener('focus', onWindowFocus);
    };
  }, [ctx]);

  const browser = ctx.vfs.backends().find((backend) => backend.mount === 'browser');
  // A store still opening at start says so until it has opened or given up.
  useEffect(() => onStorageStateChange(browser, () => setVersion((v) => v + 1)), [browser]);
  const problem = storageProblem(browser);
  const rows = model?.rows() ?? [];
  const focused = model?.selectedRow() ?? null;
  const selectedRows = model?.selectedRows() ?? [];
  const selectedPaths = selectedRows.map((row) => row.path);
  const fallbackDir = locations(ctx.vfs)[0]?.root ?? BROWSER_ROOT;
  const single = selectedRows.length === 1 ? (selectedRows[0] as TreeRow) : null;

  const open = (row: TreeRow) => {
    if (row.kind === 'file') void ctx.documents.open(row.path);
    else void model?.toggle(row.path);
  };

  /** The folder an action of the strip works in: the focused row's folder. */
  const target = () => model?.selected ?? null;

  // The Safari storage notice (R-10; storage-notice.ts). It takes no focus and blocks nothing.
  const acknowledged = useSyncExternalStore(
    (listener) => ctx.settings.subscribe(listener),
    () => storageNoticeAcknowledged(ctx),
  );
  const [environment] = useState(readNoticeEnvironment);
  const [storeEmpty, setStoreEmpty] = useState<boolean | null>(null);
  const storeKind = storeKindOf(browser);
  const wantsEmptiness = environment.installed && storeKind !== 'none' && storeKind !== 'memory';
  useEffect(() => {
    if (!wantsEmptiness) return;
    let live = true;
    void storeEmptyAtStart(ctx).then((empty) => {
      if (live) setStoreEmpty(empty);
    });
    return () => {
      live = false;
    };
  }, [ctx, wantsEmptiness]);
  const notice: StorageNoticeKind = storageNoticeKind({
    platform: ctx.platform.kind,
    ...environment,
    store: storeKind,
    storeEmpty: storeEmpty === true,
    acknowledged,
  });
  // Once on the screen, the first write in this window needs no note of its own (watchFirstWrite).
  // On the screen means visible for a moment: a panel of Editor mode that is mounted but hidden (a
  // start that goes straight on to Simulator mode with ?open=) has not shown it to anyone.
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setInterval(() => {
      const element = noticeRef.current;
      if (!element || !onScreen(element)) return;
      markStorageNoticeSeen(ctx);
      window.clearInterval(timer);
    }, NOTICE_SEEN_AFTER_MS);
    return () => window.clearInterval(timer);
  }, [ctx, notice]);
  const doImport = (folder: boolean, into?: VPath) => {
    // The chooser must open inside the click: start it before anything is awaited.
    const picking = pickFiles({ multiple: true, folder });
    void (async () => {
      const files = await picking;
      if (!files) return;
      const dir = into ?? (await folderFor(ctx, target(), fallbackDir));
      const items = importItemsOf(files).map((item, i) => ({ ...item, size: (files[i] as File).size }));
      const result = await importInto(ctx, dir, items, { estimate: pageEstimator() });
      if (result && model) await model.reveal(result.written[0] ?? dir);
    })();
  };

  /** The rows Export acts on: the selection, linked files' root as its files. */
  const exportRows: ExportRow[] = selectedRows.map((row) => ({ path: row.path, kind: row.kind, label: row.name }));
  const exportLabel = exportCaption(ctx.vfs, exportRows);
  const doExport = () => {
    let paths = selectedPaths;
    if (paths.length === 1 && paths[0] === '/linked') {
      paths = rows.filter((row) => row.linked).map((row) => row.path);
    }
    if (paths.length === 0) paths = [fallbackDir];
    void exportPath(ctx, paths, (name, bytes) => downloadBytes(name, bytes));
  };

  const deletable = selectedRows.filter((row) => row.kind !== 'root');
  const doDelete = () => {
    if (!model || deletable.length === 0) return;
    const before = model.selectable();
    const paths = deletable.map((row) => row.path);
    void (async () => {
      const outcome = await deleteItems(deps, paths);
      if (!outcome.confirmed) return;
      await model.settled();
      if (outcome.remaining.length > 0) {
        model.setSelection(outcome.remaining);
      } else {
        const gone = [...outcome.deleted, ...outcome.removedLinked];
        const next = focusAfterDelete(before, gone, (p) => `/${splitVPath(p).mount}`);
        if (next) model.select(next);
      }
      treeRef.current?.focus();
    })();
  };

  const doNewFolder = () => {
    void (async () => {
      const parent = await folderFor(ctx, target(), fallbackDir);
      const created = await newFolder(ctx, parent);
      // Only a new folder moves the focus to the tree (where it is selected). On Cancel the dialog
      // service has already put the focus back where it was before the dialog opened (2.10; Q1-1).
      if (!created) return;
      if (model) await model.reveal(created);
      treeRef.current?.focus();
    })();
  };
  const doRename = () => {
    const path = single?.path;
    if (!path || single?.kind === 'root' || single?.linked) return;
    void (async () => {
      const renamed = await renamePath(ctx, path);
      if (!renamed) return; // Cancel: the dialog service returns the focus (2.10; Q1-1)
      if (model) await model.reveal(renamed);
      treeRef.current?.focus();
    })();
  };
  const doMoveTo = () => {
    const items = movableItems(selectedPaths);
    if (items.length === 0) return;
    void (async () => {
      const targets = await moveTargets(deps, items);
      const chosen = await ctx.dialogs.open<MoveToDialogProps, MoveToDialogResult>(MOVE_TO_DIALOG_ID, {
        items,
        targets,
      });
      if (!chosen) return;
      const outcome = await transferItems(deps, items, chosen);
      if (outcome.done && model) {
        const first = outcome.written[0]?.[1];
        if (first) await model.reveal(first);
      }
      treeRef.current?.focus();
    })();
  };
  const doUndo = () => {
    void (async () => {
      const back = await undoLast(deps, stack);
      if (back[0] && model) await model.reveal(back[0]);
      treeRef.current?.focus();
    })();
  };
  const doTrash = () => void ctx.commands.run('app.files.trash');

  const onlyLinked = selectedRows.length > 0 && selectedRows.every((row) => row.linked);
  const contextItems: MenuEntry[] = onlyLinked
    ? [
        {
          type: 'item',
          id: 'open',
          caption: '&Open',
          disabled: !single,
          onSelect: () => single && open(single),
        },
        {
          type: 'item',
          id: 'history',
          caption: EARLIER_VERSIONS_CAPTION,
          disabled: !single || !ctx.history,
          onSelect: () => single && void ctx.commands.run('ed.file.history', { path: single.path }),
        },
        { type: 'item', id: 'export', caption: `&${exportLabel}`, onSelect: doExport },
        { type: 'item', id: 'removeFromList', caption: REMOVE_FROM_LIST_CAPTION, onSelect: doDelete },
      ]
    : [
        {
          type: 'item',
          id: 'open',
          caption: '&Open',
          disabled: single?.kind !== 'file',
          onSelect: () => single && open(single),
        },
        { type: 'separator' },
        { type: 'item', id: 'newFolder', caption: 'New &Folder...', onSelect: doNewFolder },
        { type: 'item', id: 'importFiles', caption: '&Import Files...', onSelect: () => doImport(false) },
        { type: 'item', id: 'importFolder', caption: 'Import Fol&der...', onSelect: () => doImport(true) },
        { type: 'item', id: 'export', caption: `&${exportLabel}`, onSelect: doExport },
        { type: 'separator' },
        {
          type: 'item',
          id: 'moveTo',
          caption: MOVE_TO_CAPTION,
          disabled: movableItems(selectedPaths).length === 0,
          onSelect: doMoveTo,
        },
        {
          type: 'item',
          id: 'rename',
          caption: '&Rename...',
          shortcut: 'F2',
          disabled: !single || single.kind === 'root' || single.linked === true,
          onSelect: doRename,
        },
        {
          type: 'item',
          id: 'delete',
          caption: 'De&lete',
          shortcut: 'Del',
          disabled: deletable.length === 0,
          onSelect: doDelete,
        },
        { type: 'separator' },
        {
          type: 'item',
          id: 'history',
          caption: EARLIER_VERSIONS_CAPTION,
          disabled: single?.kind !== 'file' || !ctx.history,
          onSelect: () => single && void ctx.commands.run('ed.file.history', { path: single.path }),
        },
        {
          type: 'item',
          id: 'undo',
          caption: undoCaption(undoKind),
          disabled: undoKind === null,
          onSelect: doUndo,
        },
      ];
  const importItems: MenuEntry[] = [
    { type: 'item', id: 'importFiles', caption: '&Files or .zip...', onSelect: () => doImport(false) },
    { type: 'item', id: 'importFolder', caption: 'F&older...', onSelect: () => doImport(true) },
  ];

  const openMenuAtFocus = () => {
    const element = focused ? document.getElementById(rowId(idBase, focused.path)) : treeRef.current;
    const box = element?.getBoundingClientRect();
    setMenuAt(box ? { x: box.left + 16, y: box.bottom } : { x: 0, y: 0 });
  };

  const owned = ownedChords(os);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!model) return;
    // The chords the tree owns (P1.3): Select All, Undo, Redo never reach the editor from here.
    const chord = chordOf(event.nativeEvent, os);
    if (chord !== null) {
      if (owned.selectAll.includes(chord)) {
        event.preventDefault();
        model.selectAll();
        return;
      }
      if (owned.undo.includes(chord)) {
        event.preventDefault();
        doUndo();
        return;
      }
      if (owned.redo.includes(chord)) {
        event.preventDefault(); // the Files panel has no redo
        return;
      }
    }
    const selectionKey = selectionKeyOf(event, os);
    if (selectionKey) {
      event.preventDefault();
      switch (selectionKey.kind) {
        case 'extend': {
          const next = model.neighbour(selectionKey.key);
          if (next) model.selectRange(next);
          return;
        }
        case 'focus': {
          const next = model.neighbour(selectionKey.key);
          if (next) model.moveFocus(next);
          return;
        }
        case 'toggle':
          if (model.selected) model.toggleSelected(model.selected);
          return;
        case 'clear':
          model.clearSelection();
          return;
        case 'delete':
          doDelete();
          return;
      }
    }
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey && !event.ctrlKey && !event.altKey)) {
      event.preventDefault();
      openMenuAtFocus();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'F2') {
      event.preventDefault();
      doRename();
      return;
    }
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

  // Keep the focused row in view.
  useEffect(() => {
    if (!focused) return;
    document.getElementById(rowId(idBase, focused.path))?.scrollIntoView({ block: 'nearest' });
  }, [focused, idBase]);

  // ---- drag and drop (P3.2.4) ----
  const stopExpandTimer = () => {
    expandTimer.current?.stop();
    expandTimer.current = null;
  };
  const endDrag = () => {
    dragged.current = null;
    stopExpandTimer();
    setDropOn(null);
  };
  const carries = (event: DragEvent) => Array.from(event.dataTransfer.types).includes(FILES_DRAG_TYPE);
  const onRowDragStart = (event: DragEvent<HTMLDivElement>, row: TreeRow) => {
    if (!model || row.kind === 'root' || row.linked) {
      event.preventDefault();
      return;
    }
    pendingClick.current = null;
    if (!model.isSelected(row.path)) model.select(row.path);
    const paths = movableItems(model.selectedPaths());
    dragged.current = paths;
    event.dataTransfer.setData(FILES_DRAG_TYPE, JSON.stringify(paths));
    event.dataTransfer.effectAllowed = 'copyMove';
  };
  const onRowDragOver = (event: DragEvent<HTMLDivElement>, row: TreeRow) => {
    const items = dragged.current;
    if (!items || !carries(event)) return;
    const dir = dropFolderOf(row);
    if (refusedTarget(items, dir)) {
      event.dataTransfer.dropEffect = 'none';
      if (dropOn) setDropOn(null);
      return;
    }
    event.preventDefault();
    const copy = transferModeOf(items, dir) === 'copy';
    event.dataTransfer.dropEffect = copy ? 'copy' : 'move';
    if (dropOn?.path !== row.path) {
      setDropOn({ path: row.path, copy: copy ? copyTo(displayPath(ctx.vfs, dir)) : null });
      stopExpandTimer();
      if (row.kind !== 'file' && !row.expanded && model) {
        const id = setTimeout(() => void model.expand(row.path), DRAG_EXPAND_MS);
        expandTimer.current = { path: row.path, stop: () => clearTimeout(id) };
      }
    }
  };
  const onRowDrop = (event: DragEvent<HTMLDivElement>, row: TreeRow) => {
    const items = dragged.current;
    if (!items || !carries(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const dir = dropFolderOf(row);
    endDrag();
    if (refusedTarget(items, dir)) return;
    void (async () => {
      const outcome = await transferItems(deps, items, dir);
      if (outcome.done && model) {
        const first = outcome.written[0]?.[1];
        if (first) await model.reveal(first);
      }
    })();
  };

  const countText = selectedRows.length > 1 ? selectedCount(selectedRows.length) : '';
  const historyCommandOn = ctx.commands.isEnabled('app.files.trash');

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
        <IconButton icon="external" size="small" label={exportLabel} onClick={doExport} />
        <IconButton icon="close" size="small" label="Delete" disabled={deletable.length === 0} onClick={doDelete} />
        <IconButton icon="trash" size="small" label={TRASH_BUTTON} disabled={!historyCommandOn} onClick={doTrash} />
      </Toolbar>
      <p role="status" className="e68-files__count">
        {countText}
      </p>
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
      {notice && (
        <div
          ref={noticeRef}
          role="note"
          aria-label={STORAGE_NOTICE_LABEL}
          className="e68-files__notice"
          data-e68-storage-notice={notice}
        >
          <p className="e68-files__notice-text">{storageNoticeText(notice)}</p>
          <div className="e68-files__notice-buttons">
            {notice === 'tab' ? (
              <Button
                size="small"
                tabIndex={0}
                caption={STORAGE_NOTICE_EXPORT_CAPTION}
                onClick={() => void exportPath(ctx, BROWSER_ROOT, (name, bytes) => downloadBytes(name, bytes))}
              />
            ) : (
              <Button
                size="small"
                tabIndex={0}
                caption={STORAGE_NOTICE_IMPORT_CAPTION}
                onClick={() => doImport(false, BROWSER_ROOT)}
              />
            )}
            <Button
              size="small"
              tabIndex={0}
              caption={STORAGE_NOTICE_DISMISS_CAPTION}
              onClick={(event) => {
                // The button goes with the notice: the keyboard continues in the tree, not on the page.
                const hadFocus = event.currentTarget.contains(document.activeElement);
                acknowledgeStorageNotice(ctx);
                if (hadFocus) treeRef.current?.focus();
              }}
            />
          </div>
        </div>
      )}
      <div
        ref={treeRef}
        role="tree"
        aria-label="Files"
        aria-multiselectable="true"
        tabIndex={0}
        data-e68-panel-focus=""
        data-e68-own-keys={ownKeysAttribute(os)}
        aria-activedescendant={focused ? rowId(idBase, focused.path) : undefined}
        className="e68-files__tree"
        onKeyDown={onKeyDown}
        onFocus={(event) => {
          if (event.target !== event.currentTarget) return;
          if (model && !model.selected && rows[0]) model.select(rows[0].path);
        }}
        onContextMenu={(event: MouseEvent<HTMLDivElement>) => {
          event.preventDefault();
          setMenuAt({ x: event.clientX, y: event.clientY });
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            stopExpandTimer();
            setDropOn(null);
          }
        }}
      >
        {rows.map((row) => {
          const over = dropOn?.path === row.path;
          return (
            <div
              key={row.path}
              id={rowId(idBase, row.path)}
              role="treeitem"
              aria-level={row.depth}
              aria-expanded={row.kind === 'file' ? undefined : row.expanded}
              aria-selected={model?.isSelected(row.path) ?? false}
              title={
                over && dropOn?.copy
                  ? dropOn.copy
                  : (row.tooltip ?? (row.kind === 'root' ? row.name : splitVPath(row.path).rel))
              }
              className={`e68-files__row e68-files__row--${row.kind}${over ? ' e68-files__row--drop' : ''}`}
              style={{ paddingInlineStart: `calc(var(--sp-1) + var(--sp-4) * ${row.depth - 1})` }}
              draggable={row.kind !== 'root' && !row.linked}
              data-e68-path={row.path}
              onPointerDown={(event) => {
                if (!model || (event.button !== 0 && event.button !== 2)) return;
                pendingClick.current = null;
                if (event.button === 2) {
                  if (!model.isSelected(row.path)) model.select(row.path);
                  return;
                }
                if (event.shiftKey) model.selectRange(row.path);
                else if (isToggleClick(event, os)) model.toggleSelected(row.path);
                else if (model.isSelected(row.path) && model.selection.size > 1) pendingClick.current = row.path;
                else model.select(row.path);
              }}
              onClick={(event) => {
                // A plain click on a row of a multiple selection selects it alone (not a drag).
                if (pendingClick.current === row.path) {
                  pendingClick.current = null;
                  model?.select(row.path);
                }
                // The twisty opens and closes without a double-click.
                if ((event.target as Element).closest('.e68-files__twisty') && row.kind !== 'file')
                  void model?.toggle(row.path);
              }}
              onDoubleClick={() => open(row)}
              onDragStart={(event) => onRowDragStart(event, row)}
              onDragOver={(event) => onRowDragOver(event, row)}
              onDrop={(event) => onRowDrop(event, row)}
              onDragEnd={endDrag}
            >
              <span className="e68-files__twisty" aria-hidden="true">
                {row.kind !== 'file' && <Icon name={row.expanded ? 'chevron-down' : 'chevron-right'} size={12} />}
              </span>
              <Icon name={row.kind === 'file' ? 'file' : 'folder'} size={14} />
              <span className="e68-files__name">{row.name}</span>
              {row.secondary && <span className="e68-files__secondary">{row.secondary}</span>}
              {row.error && <span className="e68-files__error"> ({row.error})</span>}
            </div>
          );
        })}
      </div>
      <StorageLine ctx={ctx} />
      <ContextMenu items={contextItems} label="Files" at={menuAt} onClose={() => setMenuAt(null)} />
    </div>
  );
}
