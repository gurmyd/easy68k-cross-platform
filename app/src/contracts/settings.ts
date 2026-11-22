// Contract: settings (ARCHITECTURE.md 3.10). The store is SettingsService
// (core/settings/service.ts, W3); the defaults are core/settings/defaults.ts (W1).
//
// Owner: W1. Contracts import nothing but other contracts (3.1).

import type { TabType } from './engine';

export interface SyntaxStyle {
  color: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
} // color = COLORREF
export type SyntaxElement = 'code' | 'unknown' | 'directive' | 'comment' | 'label' | 'structure' | 'error' | 'text';

export interface EditorSettings {
  // defaults = editor-ui §11.4 "Default when the file is missing"
  generateList: boolean;
  generateSRecord: boolean;
  saveThenAssemble: boolean;
  showWarnings: boolean;
  crossReference: boolean;
  macrosExpanded: boolean;
  structuredExpanded: boolean;
  constantsExpanded: boolean;
  fontName: string;
  fontSize: number;
  tabType: TabType;
  fixedTabSize: number;
  autoIndent: boolean;
  realTabs: boolean;
  assembleBitField: boolean;
  styles: Record<SyntaxElement, SyntaxStyle>;
  highlightDisabled: boolean;
  printBlack: boolean;
  backgroundColor: number;
  colorPreset: -1 | 0 | 1 | 2 | 3 | 4 | 5; // 0 Color1, 1 Color2, 2 No Color, 3 Custom, 4 Disabled, 5 Auto (port; default)
  template: string; // template.NEW text; default = shipped template, editor-ui §12.2
  lineNumbers: boolean; // port; default true
}

export interface SimSettings {
  // defaults = sim-ui §14.3
  execLogType: 0 | 1 | 2 | 3;
  outputLogType: 0 | 1;
  exceptions: boolean;
  bitField: boolean;
  memoryAddress: number;
  whichStack: number; // 0..8, default 8
  seg7Address: number;
  ledAddress: number;
  switchAddress: number;
  buttonAddress: number;
  outputFont: { name: string; size: number };
  listingFont: { name: string; size: number };
  printerFont: { name: string; size: number };
  autoTraceIntervalMs: number;
  disableDisplay: boolean;
  speed: { mode: 'original' | 'max' | 'custom'; instructionsPerSecond: number }; // port; 4.5
  highlightChangedRegisters: boolean; // port; default true
}

/** A stored dock arrangement (ARCHITECTURE-PLUS P3.1). Independent of the docking library's model. */
export type DockNode =
  | { type: 'row' | 'column'; weight: number; children: DockNode[] }
  | { type: 'tabs'; weight: number; panels: string[]; selected: string };

/** Where a hidden panel was, to put it back there when it is shown again. */
export interface DockParked {
  near: string;
  side: 'tab' | 'left' | 'right' | 'above' | 'below';
}

export interface DockLayouts {
  version: 1;
  locked?: boolean; // absent = true (D2)
  editor?: DockNode; // absent = the default arrangement (P3.1.3)
  simulator?: DockNode;
  parked?: Record<string, DockParked>; // key = panel id
}

/** The two switches of `Options > Port Additions...` (ARCHITECTURE-PLUS P1.2, P3.5). */
export interface PlusSettings {
  viewer: boolean; // default true (P3.4)
  history: boolean; // default true (P3.3)
}

export interface AppSettings {
  theme: 'system' | 'light' | 'dark';
  layout: {
    panels: Record<string, { visible: boolean }>; // key = panel id (2.4)
    splits: Record<string, number>; // key = splitter id, value = fraction 0..1
    editorPanes: 'one' | 'horizontal' | 'vertical';
    outputZoom: 'fit' | 1 | 2;
    /** ARCHITECTURE-PLUS P4.2; validated where it is read (ui/dock/stored.ts readDock). */
    dock?: DockLayouts;
  };
  serialPortMap: Record<string, string>; // desktop: "COM4" -> device path (3.3.4)
  /** ARCHITECTURE-PLUS P4.2; validated where it is read (core/plus/settings.ts readPlus). */
  plus?: PlusSettings;
}

export interface Settings {
  version: 1;
  editor: EditorSettings;
  sim: SimSettings;
  app: AppSettings;
}

export interface SettingsService {
  get(): Settings;
  update(change: (current: Settings) => Settings): void; // persists and notifies
  subscribe(listener: () => void): () => void;
}
