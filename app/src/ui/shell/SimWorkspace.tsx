// The workspace frame of Simulator mode (ARCHITECTURE.md 2.3). Owner: W3.
//
//   +---------------------------+----------------------------------+
//   | registers                 | output                           |
//   +---------------------------+                                  |
//   | listing                   +==================================+
//   |                           | [Memory][Stack][Hardware][...]   |
//   +===========================+ the tool panel in front          |
//   | messages                  |                                  |
//   +---------------------------+----------------------------------+
//
// The left column is the original main window and is always visible. The right column holds the
// Output panel and, below it, the tool tabs: Memory, Stack, Hardware, Break Points, Log. Closing
// a tool tab (its `x`) hides the panel, as closing the original window did; when all are closed
// the Output panel takes the whole column. All three separators can be dragged, and a
// double-click restores the default.
//
// Below 1100 px of window width the right column moves under the left one and the tool tabs join
// the Output panel as tabs of one group.
//
// Every visible panel stays mounted, also a tool panel behind another tab and the Output panel
// while collapsed: the original's windows are all on screen at once, and a panel's "is shown"
// side effects (the Hardware panel zeroes the switch byte, 2.4) must not repeat on a tab change.

import { useEffect, useRef, useState } from 'react';
import { useAppState, useApplication, useShellState } from '../../state/context';
import { NARROW_WIDTH, PANEL_TITLES, TOOL_PANELS, isPanelVisible } from '../../state/layout';
import { hidePanel, showPanel } from '../../state/panels';
import { shallowEqual } from '../../state/store';
import { Splitter, Tabs, tabId, tabPanelId } from '../components';
import { PanelRegion } from './PanelRegion';
import { SplitPane, useElementSize, useSplit } from './SplitPane';

const TAB_BASE = 'e68-tools';
/** Height of the component kit's tab strip: 30 px of tabs and a 1 px border. */
const TAB_STRIP_HEIGHT = 31;

/** True while the window is narrower than 1100 px (2.3). False where the question cannot be asked. */
function useNarrow(): boolean {
  const query = `(max-width: ${NARROW_WIDTH - 0.02}px)`;
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);
  return narrow;
}

function LeftColumn() {
  return (
    <div className="e68-simws__left">
      <PanelRegion id="registers" mode="simulator" className="e68-region--auto" />
      <SplitPane
        splitId="sim.messages"
        orientation="horizontal"
        sized="second"
        label="Resize the Messages panel"
        className="e68-simws__main"
        first={<PanelRegion id="listing" mode="simulator" className="e68-region--fill" />}
        second={<PanelRegion id="messages" mode="simulator" className="e68-region--fill" />}
      />
    </div>
  );
}

function RightColumn({ narrow }: { narrow: boolean }) {
  const app = useApplication();
  const { ctx } = app;
  const container = useRef<HTMLDivElement>(null);
  const { height } = useElementSize(container);
  const split = useSplit('sim.tools', height);
  const tools = useAppState(
    (state) => TOOL_PANELS.filter((id) => isPanelVisible(state.settings, id, ctx.platform.kind)),
    shallowEqual,
  );
  const activeTool = useShellState((state) => state.activeTool);
  const collapsed = useShellState((state) => state.outputCollapsed);

  // Narrow: Output is the first tab of the group. Wide: it has its own place above the tabs.
  const tabs: string[] = narrow ? ['output', ...tools] : tools;
  const selected = activeTool !== null && tabs.includes(activeTool) ? activeTool : (tabs[0] ?? null);
  const title = (id: string) =>
    app.panels.find('simulator', id)?.title ?? PANEL_TITLES[id as keyof typeof PANEL_TITLES];
  const select = (id: string) =>
    app.shell.setState((state) => (state.activeTool === id ? state : { ...state, activeTool: id }));

  const strip = tabs.length > 0 && (
    <Tabs
      key="tabs"
      idBase={TAB_BASE}
      variant="tool"
      label="Tool panels"
      items={tabs.map((id) => ({ id, label: title(id), closable: id !== 'output' }))}
      selectedId={selected}
      onSelect={select}
      onClose={(id) => hidePanel(ctx, id)}
    />
  );
  const asTab = (id: string) => ({ id: tabPanelId(TAB_BASE, id), labelledBy: tabId(TAB_BASE, id) });

  const output = (
    <div
      key="output"
      className="e68-simws__output"
      data-collapsed={collapsed && !narrow ? 'true' : undefined}
      hidden={narrow && selected !== 'output'}
    >
      {collapsed && !narrow && (
        <button
          type="button"
          className="e68-simws__expand"
          aria-expanded={false}
          onClick={() => showPanel(ctx, 'output')}
        >
          {title('output')}
        </button>
      )}
      <PanelRegion
        id="output"
        mode="simulator"
        className="e68-region--fill"
        hidden={collapsed && !narrow}
        {...(narrow ? { tabPanel: asTab('output') } : {})}
      />
    </div>
  );
  // Wide: the separator sizes the tool area, which is the tab strip plus the panel in front.
  const sizedByBar = !narrow && !collapsed;
  const toolRegions = tools.map((id) => (
    <PanelRegion
      key={id}
      id={id}
      mode="simulator"
      className={sizedByBar ? 'e68-region--fixed e68-simws__tool' : 'e68-region--fill e68-simws__tool'}
      style={sizedByBar ? { flexBasis: `calc(${split.basis} - ${TAB_STRIP_HEIGHT}px)` } : undefined}
      hidden={id !== selected}
      tabPanel={asTab(id)}
    />
  ));
  const bar = sizedByBar && tools.length > 0 && (
    <Splitter key="bar" orientation="horizontal" invert label="Resize the tool panels" {...split.bar} />
  );

  // One flat list of keyed children in both layouts, so that no panel is ever remounted when the
  // window crosses the 1100 px mark or a tool tab is opened or closed.
  return (
    <div ref={container} className="e68-simws__right" data-narrow={narrow ? 'true' : undefined}>
      {narrow ? [strip, output] : [output, bar, strip]}
      {toolRegions}
    </div>
  );
}

export function SimWorkspace() {
  const narrow = useNarrow();
  const container = useRef<HTMLDivElement>(null);
  const size = useElementSize(container);
  const split = useSplit('sim.columns', narrow ? size.height : size.width);
  return (
    <div ref={container} className="e68-simws" data-narrow={narrow ? 'true' : undefined}>
      <div className="e68-simws__column" style={{ flexBasis: split.basis }}>
        <LeftColumn />
      </div>
      <Splitter orientation={narrow ? 'horizontal' : 'vertical'} label="Resize the two columns" {...split.bar} />
      <div className="e68-simws__column e68-simws__column--rest">
        <RightColumn narrow={narrow} />
      </div>
    </div>
  );
}
