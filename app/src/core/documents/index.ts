// Documents (ARCHITECTURE.md 3.9): file format, the registry of EditorStates and the document service.
// Owner: E1.

export {
  countUnmappable,
  decodeFile,
  encodeFile,
  encodeForAssembler,
  getsTrailer,
  looksLikeUtf8,
  stripTrailer,
  trailerText,
  upperExt,
  TRAILER_PREFIX,
  UTF8_BANNER,
  type LoadedSource,
} from './format';
export { DocumentRegistry, type ExtensionSource, type RegistryEvent } from './registry';
export {
  DocumentManager,
  docDefaults,
  documentManagerOf,
  documentRegistryOf,
  isListPath,
  kindAfterSaveAs,
  type DocumentPatch,
  type DocumentServiceDeps,
  type RestoredDocument,
} from './service';
export * as documentMessages from './messages';
