// The application shell (ARCHITECTURE.md 2.1-2.4, 2.7; work package W3): menu bar, toolbar, mode
// switch, the workspace frames of the three modes with their regions and separators, status bar,
// dialog host and toasts.
//
// Feature packages do not import from here. They contribute panels and dialogs through their
// FeatureModule and act on panels with app/src/state/panels.ts.

export { Shell } from './Shell';
export { DialogHost, ToastHost } from './DialogHost';
export { PanelRegion, type PanelRegionProps } from './PanelRegion';
export { SplitPane, useElementSize, useSplit, type SplitPaneProps } from './SplitPane';
