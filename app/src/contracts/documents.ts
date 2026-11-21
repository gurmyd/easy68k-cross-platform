// Contract: editor documents (ARCHITECTURE.md 3.9). Implemented by E1 (core/documents/,
// features/documents/).
//
// Owner: W1. Contracts import nothing but other contracts (3.1).

import type { TabType } from './engine';
import type { VPath } from './fs';

export type DocKind = 'source' | 'list';
export interface DocumentState {
  id: string;
  path: VPath | null; // null until loaded from or saved to a file
  name: string; // file name, or "untitledN.x68"
  kind: DocKind; // IsSource
  hasName: boolean;
  tabType: TabType;
  tabSize: number;
  fontName: string; // as stored in the trailer; never rewritten to a substitute
  fontSize: number;
  insertMode: boolean;
  modified: boolean;
  /** Increases with every text change; lets panels detect staleness without reading the text. */
  revision: number;
}

export interface DocDefaults {
  fontName: string;
  fontSize: number;
  tabType: TabType;
  tabSize: number;
}

export interface DocumentService {
  list(): DocumentState[];
  active(): DocumentState | null;
  text(id: string): string; // lines separated by "\n"
  newSource(): DocumentState;
  open(path: VPath): Promise<DocumentState | null>; // editor-ui §6.2 incl. the "already open" question
  save(id: string): Promise<boolean>; // false = cancelled or failed
  saveAs(id: string): Promise<boolean>;
  reload(id: string): Promise<void>;
  close(id: string): Promise<boolean>; // false = cancelled
  closeAll(): Promise<boolean>;
  activate(id: string): void;
}
