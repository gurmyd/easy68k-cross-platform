// The window (ARCHITECTURE.md 2.1). Owner: W3.
//
//   +----------------------------------------------------------------+
//   | menu bar (mode's own menus)        [ Editor | Simulator | ... ] |
//   | toolbar (mode's own buttons)                           [theme]  |
//   +----------------------------------------------------+-----------+
//   |                  mode workspace                    |   help    |
//   +----------------------------------------------------+-----------+
//   | status bar (mode's own)                                        |
//   +----------------------------------------------------------------+
//
// One application holds three modes, one per original program. The menu bar, the toolbar and the
// status bar belong to the mode and are swapped with it. The three workspaces stay mounted, so a
// mode keeps its state while another is in front and a program keeps running while the editor is
// shown. The Help panel is a drawer on the right edge in every mode. In the macOS app the menu
// bar is the system's and the in-window one is not drawn.
//
// Editor mode and Simulator mode are docks (ui/dock/DockWorkspace.tsx, ARCHITECTURE-PLUS P3.1,
// N1): their panels can be moved and grouped; the default arrangement is today's. A dock lays out
// its panels once it is shown for the first time (its panels mount then) and keeps them mounted
// while its workspace is hidden. EASyBIN has one panel and the Help drawer stays a drawer.

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Mode } from '../../contracts';
import { MODES } from '../../commands/shell-commands';
import { useAppContext, useAppState, useApplication, useShellState } from '../../state/context';
import { isPanelVisible } from '../../state/layout';
import { focusPanelElement } from '../../state/panels';
import { EXIT_TEXT } from '../../state/shell';
import { applyThemeSetting } from '../../styles';
import { Splitter } from '../components';
import { DockWorkspace } from '../dock/DockWorkspace';
import { DialogHost, ToastHost } from './DialogHost';
import { ModeSwitch } from './ModeSwitch';
import { PanelRegion } from './PanelRegion';
import { ShellMenuBar } from './ShellMenuBar';
import { ShellToolbar } from './ShellToolbar';
import { useElementSize, useSplit } from './SplitPane';
import { StatusBar } from './StatusBar';
import './shell.css';

function Workspace({ mode }: { mode: Mode }) {
  switch (mode) {
    case 'editor':
      return <DockWorkspace mode="editor" />;
    case 'simulator':
      return <DockWorkspace mode="simulator" />;
    case 'easybin':
      return <PanelRegion id="easybin" mode="easybin" className="e68-region--fill" />;
  }
}

/** The three workspaces; only the one of the current mode is shown. */
function Workspaces({ mode }: { mode: Mode }) {
  return (
    <div className="e68-shell__workspaces">
      {MODES.map((item) => (
        <div key={item} className="e68-shell__workspace" data-e68-workspace={item} hidden={item !== mode}>
          <Workspace mode={item} />
        </div>
      ))}
    </div>
  );
}

/** Follows the theme setting (2.8): `data-theme` on the document root. */
function useTheme() {
  const theme = useAppState((state) => state.settings.app.theme);
  useLayoutEffect(() => applyThemeSetting(theme), [theme]);
}

/** Frames a focus request waits for its panel: a dock lays a panel out a few frames after it is put in. */
const FOCUS_FRAMES = 12;

/** Carries out the focus requests of state/panels.ts once the panel is on screen. */
function usePanelFocus() {
  const { shell } = useApplication();
  const request = useShellState((state) => state.focusRequest);
  useEffect(() => {
    if (!request) return;
    const done = () =>
      shell.setState((state) =>
        state.focusRequest?.serial === request.serial ? { ...state, focusRequest: null } : state,
      );
    if (focusPanelElement(document, request.panel)) return done();
    // The panel may be rendered by an update that has not been committed yet, or laid out by its
    // dock in a later frame (a tab that was just put back or a dock shown for the first time).
    let frames = 0;
    let frame = 0;
    const retry = () => {
      frames++;
      if (focusPanelElement(document, request.panel) || frames >= FOCUS_FRAMES) done();
      else frame = requestAnimationFrame(retry);
    };
    frame = requestAnimationFrame(retry);
    return () => cancelAnimationFrame(frame);
  }, [request, shell]);
}

export function Shell() {
  const ctx = useAppContext();
  const mode = useAppState((state) => state.mode);
  const exited = useShellState((state) => state.exited);
  // While a modal dialog is open the Help drawer stays above its backdrop (shell.css), so that the
  // dialog's Help button and F1 show their page (docs/requests/H1-help-from-dialogs.md).
  const modal = useAppState((state) => state.dialogs.stack.some((dialog) => dialog.modal));
  useTheme();
  usePanelFocus();

  const { os, kind } = ctx.platform;
  // The macOS app has the system's menu bar (2.1).
  const ownMenuBar = !(kind === 'desktop' && os === 'mac');

  if (exited) {
    // Web: Exit has run its prompts; a page cannot close its own tab (1.4 note 4).
    return (
      <div className="e68-shell" data-os={os} data-platform={kind}>
        <main className="e68-shell__exit">
          <p>{EXIT_TEXT}</p>
        </main>
      </div>
    );
  }

  return (
    <div
      className="e68-shell"
      data-mode={mode}
      data-os={os}
      data-platform={kind}
      data-modal={modal ? 'true' : undefined}
    >
      <header className="e68-shell__header">
        <div className="e68-shell__menurow">
          {ownMenuBar && <ShellMenuBar mode={mode} />}
          <span className="e68-shell__grow" />
          <ModeSwitch mode={mode} />
        </div>
        <ShellToolbar mode={mode} />
      </header>
      <Body mode={mode} />
      <StatusBar mode={mode} />
      <DialogHost />
      <ToastHost />
    </div>
  );
}

/** The workspaces and, when it is shown, the Help drawer on the right edge (2.1). */
function Body({ mode }: { mode: Mode }) {
  const ctx = useAppContext();
  const container = useRef<HTMLElement>(null);
  const { width } = useElementSize(container);
  const split = useSplit('app.help', width);
  const helpVisible = useAppState((state) => isPanelVisible(state.settings, 'help', ctx.platform.kind));
  // Keyed children: opening or closing Help never remounts a workspace.
  return (
    <main ref={container} className="e68-shell__body">
      <Workspaces key="workspaces" mode={mode} />
      {helpVisible && (
        <Splitter key="help-bar" orientation="vertical" invert label="Resize the Help panel" {...split.bar} />
      )}
      {helpVisible && (
        <PanelRegion
          key="help"
          id="help"
          mode={mode}
          className="e68-region--fixed"
          style={{ flexBasis: split.basis }}
        />
      )}
    </main>
  );
}
