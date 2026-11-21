// The port's own Open and Save dialogs, `file.open` and `file.save` (ARCHITECTURE.md 3.8.5): the
// stores the Vfs mounts (the browser store, an opened folder) as a folder list, a file name field,
// the request's filters, and a button per provider ("From this computer...", "Open folder...").
// The decisions behind the buttons are in dialogs.ts. Owner: FS1.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DialogProps, DirEntry, FileSourceProvider, VPath } from '../../contracts';
import { basename, childPath, dirname, isWithin, splitVPath } from '../../core/paths/winpath';
import { useAppContext } from '../../state/context';
import { Button, Dialog, Icon, IconButton, ListBox, Select, TextField, type ListBoxItem } from '../../ui/components';
import { newFolder } from './actions';
import { decideOpen, decideSave, visibleEntries, type DialogStep, type FileDialogProps } from './dialogs';
import { BROWSER_PROVIDER_ID, FOLDER_PROVIDER_ID, NATIVE_PROVIDER_ID, isImportingUpload } from './providers';
import { locations, sortEntries } from './store';
import './files.css';

type Result = VPath[] | VPath | null;

const NBSP = ' ';

export function FileDialog({ props, close }: DialogProps<FileDialogProps, Result>) {
  const ctx = useAppContext();
  const { vfs } = ctx;
  const isSave = props.kind === 'save';
  const isFolderChooser = props.kind === 'save' && props.folder === true;
  const request = props.request;
  const [roots, setRoots] = useState(() => locations(vfs));
  const [dir, setDir] = useState<VPath | null>(props.startDir ?? roots[0]?.root ?? null);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [typed, setTyped] = useState(props.kind === 'save' ? props.initialName : '');
  const [filterIndex, setFilterIndex] = useState(0);
  const [customFilter, setCustomFilter] = useState<{ label: string; patterns: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<FileSourceProvider[]>(() => props.registry.available());
  const nameRef = useRef<HTMLInputElement>(null);
  const closed = useRef(false);

  const finish = useCallback(
    (result: Result) => {
      if (closed.current) return;
      closed.current = true;
      close(result);
    },
    [close],
  );

  const reload = useCallback(async () => {
    setRoots(locations(vfs));
    if (!dir) return;
    try {
      setEntries(sortEntries(await vfs.list(dir)));
      setListError(null);
    } catch (error) {
      setEntries([]);
      setListError(error instanceof Error ? error.message : String(error));
    }
  }, [vfs, dir]);

  useEffect(() => {
    void reload();
    if (!dir) return;
    // Files written meanwhile (another window, a simulator) appear in the list.
    return vfs.subscribe(dir, (change) => {
      if (dirname(change.path) === dir || change.path === dir) void reload();
    });
  }, [vfs, dir, reload]);

  useEffect(() => props.registry.subscribe(() => setProviders(props.registry.available())), [props.registry]);

  const filters = request.filters.length > 0 ? request.filters : [{ label: 'Any File  [*.*]', patterns: ['*.*'] }];
  const filter = customFilter ?? filters[filterIndex];
  const shown = useMemo(() => visibleEntries(entries, filter), [entries, filter]);
  const items: ListBoxItem<string>[] = shown.map((entry) => ({
    value: entry.name,
    label: entry.name,
    render: () => (
      <span className="e68-files__entry">
        <Icon name={entry.kind === 'dir' ? 'folder' : 'file'} size={14} />
        <span className="e68-files__entry-name">{entry.name}</span>
      </span>
    ),
  }));

  // "Look in": the stores, and the folders from the current one's store down to it.
  const lookIn = useMemo(() => {
    const options: { value: VPath; label: string }[] = [];
    for (const root of roots) {
      options.push({ value: root.root, label: root.label });
      if (dir && isWithin(dir, root.root) && dir !== root.root) {
        const segments = splitVPath(dir).rel.split('/');
        segments.forEach((segment, i) => {
          options.push({
            value: childPath(root.root, ...segments.slice(0, i + 1)),
            label: `${NBSP.repeat(3 * (i + 1))}${segment}`,
          });
        });
      }
    }
    return options;
  }, [roots, dir]);

  const navigate = (next: VPath) => {
    setDir(next);
    setSelected(null);
    setCustomFilter(null);
  };

  const apply = async (step: DialogStep) => {
    switch (step.kind) {
      case 'done':
        finish(isSave ? (step.paths[0] as VPath) : step.paths);
        return;
      case 'abandon':
        finish(null);
        return;
      case 'navigate':
        navigate(step.dir);
        if (!isSave) setTyped('');
        return;
      case 'filter':
        setCustomFilter(step.filter);
        return;
      case 'error':
        await ctx.dialogs.messageBox({ title: step.title, text: step.text, icon: 'warning', buttons: ['OK'] });
        nameRef.current?.focus();
        return;
      default:
        return;
    }
  };

  const accept = async () => {
    if (!dir || busy) return;
    setBusy(true);
    try {
      const entry = selected !== null ? entries.find((e) => e.name === selected) : undefined;
      // The folder chooser with no name typed takes the selected folder, else the folder shown.
      const name = isFolderChooser && typed.trim() === '' && entry?.kind === 'dir' ? entry.name : typed;
      const step =
        props.kind === 'save'
          ? await decideSave(
              vfs,
              ctx.dialogs,
              dir,
              name,
              customFilter ? -1 : filterIndex,
              props.request,
              isFolderChooser,
            )
          : await decideOpen(
              vfs,
              dir,
              typed,
              entry ? { path: childPath(dir, entry.name), kind: entry.kind } : null,
              request.title,
            );
      await apply(step);
    } finally {
      setBusy(false);
    }
  };

  const activate = (name: string) => {
    const entry = entries.find((e) => e.name === name);
    if (!entry || !dir) return;
    if (entry.kind === 'dir') {
      navigate(childPath(dir, entry.name));
      return;
    }
    setTyped(entry.name);
    void (async () => {
      setBusy(true);
      try {
        const step =
          props.kind === 'save'
            ? await decideSave(vfs, ctx.dialogs, dir, entry.name, customFilter ? -1 : filterIndex, props.request)
            : ({ kind: 'done', paths: [childPath(dir, entry.name)] } as DialogStep);
        await apply(step);
      } finally {
        setBusy(false);
      }
    })();
  };

  const runProvider = (provider: FileSourceProvider) => {
    // Called inside the click: a provider that shows the browser's file chooser needs the gesture.
    const pending = props.kind === 'save' ? provider.save?.(props.request) : provider.open?.(props.request);
    if (!pending) return;
    setBusy(true);
    const before = new Set(locations(vfs).map((l) => l.root));
    void pending
      .then((result: VPath[] | VPath | null) => {
        if (result && (!Array.isArray(result) || result.length > 0)) {
          finish(result);
          return;
        }
        // Nothing chosen, or a store was mounted ("Open folder..."): show the stores again.
        const now = locations(vfs);
        setRoots(now);
        const added = now.find((l) => !before.has(l.root));
        if (added) navigate(added.root);
        else void reload();
      })
      .catch(async (error: unknown) => {
        await ctx.dialogs.messageBox({
          title: request.title,
          text: error instanceof Error ? error.message : String(error),
          icon: 'error',
          buttons: ['OK'],
        });
      })
      .finally(() => setBusy(false));
  };

  const providerButtons = providers.filter(
    (p) =>
      p.id !== NATIVE_PROVIDER_ID &&
      p.id !== BROWSER_PROVIDER_ID &&
      (props.kind === 'save' ? typeof p.save === 'function' : typeof p.open === 'function'),
  );
  const hasFolderProvider = providers.some((p) => p.id === FOLDER_PROVIDER_ID);
  const storeLabel = roots.find((r) => r.backend.mount === 'browser')?.label ?? 'My Programs';
  const atRoot = !dir || splitVPath(dir).rel === '';

  return (
    <Dialog
      title={request.title}
      onCancel={() => finish(null)}
      initialFocus={nameRef}
      width={600}
      className="e68-filedialog"
      footer={
        <>
          <Button
            caption={isFolderChooser ? '&OK' : isSave ? '&Save' : '&Open'}
            isDefault
            disabled={busy || !dir}
            onClick={() => void accept()}
          />
          <Button caption="Cancel" onClick={() => finish(null)} />
        </>
      }
    >
      <div className="e68-filedialog__lookin">
        <Select
          label="Look &in:"
          options={lookIn}
          value={dir ?? ''}
          onChange={(value) => navigate(value)}
          className="e68-filedialog__lookin-select"
        />
        <IconButton
          icon="arrow-up"
          label="Up One Level"
          disabled={atRoot}
          onClick={() => dir && !atRoot && navigate(dirname(dir))}
        />
        {isSave && dir && (
          <IconButton
            icon="plus"
            label="Create New Folder"
            onClick={() => {
              void newFolder(ctx, dir).then((created) => {
                if (created) navigate(created);
              });
            }}
          />
        )}
      </div>
      <div className="e68-filedialog__list">
        {listError ? (
          <p role="alert" className="e68-files__message">
            {listError}
          </p>
        ) : (
          <ListBox
            items={items}
            value={selected}
            label={
              dir ? `Contents of ${basename(dir) === splitVPath(dir).mount ? storeLabel : basename(dir)}` : 'Contents'
            }
            rows={10}
            onChange={(name) => {
              setSelected(name);
              const entry = entries.find((e) => e.name === name);
              if (entry?.kind === 'file') setTyped(entry.name);
            }}
            onActivate={activate}
          />
        )}
        {!listError && shown.length === 0 && <p className="e68-filedialog__empty">This folder is empty.</p>}
      </div>
      <div className="e68-filedialog__fields">
        <TextField
          label={isFolderChooser ? 'Folder &name:' : 'File &name:'}
          value={typed}
          onChange={setTyped}
          inputRef={nameRef}
          spellCheck={false}
          autoComplete="off"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void accept();
            }
          }}
        />
        <Select
          label={isFolderChooser ? 'Show &type:' : isSave ? 'Save as &type:' : 'Files of &type:'}
          options={[
            // An <option> collapses runs of spaces; the original's labels keep theirs (2.7, captions verbatim).
            ...filters.map((f, i) => ({ value: String(i), label: f.label.replace(/ {2}/g, ' ' + NBSP) })),
            ...(customFilter ? [{ value: 'custom', label: customFilter.label }] : []),
          ]}
          value={customFilter ? 'custom' : String(filterIndex)}
          onChange={(value) => {
            if (value === 'custom') return;
            setCustomFilter(null);
            setFilterIndex(Number(value));
          }}
        />
      </div>
      {providerButtons.length > 0 && (
        <div className="e68-filedialog__providers">
          {providerButtons.map((provider) => (
            <Button key={provider.id} caption={provider.label} disabled={busy} onClick={() => runProvider(provider)} />
          ))}
        </div>
      )}
      {!isSave && (
        <p className="e68-filedialog__note">
          {`This browser keeps your files in its own storage, "${storeLabel}". `}
          {providerButtons.some(isImportingUpload)
            ? `From this computer... copies files from this computer into ${storeLabel}/Imported. `
            : ''}
          {hasFolderProvider ? 'Open folder... works on a folder of this computer directly. ' : ''}
          {'To take files out of the browser, use Export... in the Files panel.'}
        </p>
      )}
    </Dialog>
  );
}
