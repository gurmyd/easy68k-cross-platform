// A region of the workspace and the panel that fills it (ARCHITECTURE.md 2.2-2.4, 2.11).
// Owner: W3.
//
// The shell draws the frame of each mode as regions with fixed ids (state/layout.ts). A feature
// fills a region by contributing a PanelSpec with that id (FeatureModule.panels); until its
// feature exists, a region shows its title and nothing else. Every region is a `region` landmark
// named by its title and carries `data-e68-panel="<id>"`, which is how the focus functions of
// state/panels.ts and the keyboard dispatcher find it.
//
// A panel that throws while rendering is replaced by a short notice; the rest of the application
// keeps working.

import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from 'react';
import type { Mode } from '../../contracts';
import { useApplication } from '../../state/context';
import { PANEL_TITLES, type PanelId, type RegionId } from '../../state/layout';

interface BoundaryProps {
  title: string;
  children: ReactNode;
}

class PanelBoundary extends Component<BoundaryProps, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`The ${this.props.title} panel failed to render:`, error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <p role="alert" className="e68-region__failure">
        The {this.props.title} panel could not be shown: {this.state.error.message}
      </p>
    );
  }
}

export interface PanelRegionProps {
  id: PanelId | RegionId;
  mode: Mode;
  /** Layout classes of the workspace that places the region. */
  className?: string;
  style?: CSSProperties | undefined;
  /** Hidden but kept mounted: a tool panel behind another tab. */
  hidden?: boolean | undefined;
  /** The region is a tab panel of a tab strip (its role and name then come from the tab). */
  tabPanel?: { id: string; labelledBy: string };
}

export function PanelRegion({ id, mode, className, style, hidden, tabPanel }: PanelRegionProps) {
  const { panels } = useApplication();
  const spec = panels.find(mode, id);
  const title = spec?.title ?? PANEL_TITLES[id];
  const Panel = spec?.component;
  return (
    <section
      {...(tabPanel
        ? { id: tabPanel.id, role: 'tabpanel', 'aria-labelledby': tabPanel.labelledBy }
        : { role: 'region', 'aria-label': title })}
      data-e68-panel={id}
      data-empty={Panel ? undefined : 'true'}
      tabIndex={-1}
      hidden={hidden}
      className={className ? `e68-region ${className}` : 'e68-region'}
      style={style}
    >
      {Panel ? (
        <PanelBoundary title={title}>
          <Panel />
        </PanelBoundary>
      ) : (
        <h2 className="e68-region__title">{title}</h2>
      )}
    </section>
  );
}
