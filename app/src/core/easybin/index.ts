// EASyBIN without a DOM: the memory image, the file formats and the window's rules
// (docs/porting/easybin.md). Owner: B1.

export * from './constants';
export { binaryFileContents, binaryFileNames, binaryRangeValid, loadBinary, stepOf } from './binary';
export { copyMemory, fillMemory, type EditOutcome } from './copy-fill';
export { scanHex, textModeBytes } from './cstring';
export {
  FIELD_WIDTHS,
  INITIAL_FIELDS,
  hexText,
  hexUnsigned,
  hexValue,
  type EasybinFields,
  type EditableField,
} from './fields';
export {
  EasybinModel,
  type BinarySavePlan,
  type ByteTone,
  type EasybinState,
  type KeyOutcome,
  type SRecordSavePlan,
  type ViewRow,
} from './model';
export { createLineBuffer, loadSRecord, type SRecLoadResult } from './srec-load';
export { finishRecord, sRecordFile, sRecordRangeValid, sRecordText } from './srec-save';
