// The component kit (ARCHITECTURE.md 2.6-2.8, 2.11; work package W2).
//
// Import from here: `import { Button, Dialog } from '../../ui/components'`.
// The gallery (gallery/Gallery.tsx, shown at ?gallery) shows every component
// in every state and is the best place to learn the kit. The page must load
// app/src/styles (tokens, base, shared component styles) once.

export { Button, type ButtonProps } from './Button';
export { Caption, type CaptionProps } from './Caption';
export { Checkbox, type CheckboxProps } from './Checkbox';
export { ContextMenu, useContextMenu, type ContextMenuProps } from './ContextMenu';
export { DataGrid, type DataGridColumn, type DataGridProps } from './DataGrid';
export { Dialog, type DialogAnchor, type DialogProps } from './Dialog';
export { Icon, ensureIconSprite, type IconProps } from './Icon';
export { IconButton, type IconButtonProps } from './IconButton';
export { ICON_NAMES, iconId, type IconName } from './icons';
export { ListBox, type ListBoxItem, type ListBoxProps } from './ListBox';
export { MaskedField, type MaskedFieldProps } from './MaskedField';
export {
  ADDRESS_FIELD,
  INTERVAL_FIELD,
  MASK_BLANK,
  REGISTER_FIELD,
  SR_FIELD,
  applyMaskedEdit,
  blankText,
  formatMaskedValue,
  normalizeText,
  parseMaskedText,
  type MaskedConfig,
  type MaskedEdit,
  type MaskedKind,
  type MaskedState,
} from './masked';
export { Menu, type MenuProps } from './Menu';
export { MenuBar, type MenuBarHandle, type MenuBarProps } from './MenuBar';
export type {
  MenuActionEntry,
  MenuBarMenu,
  MenuCheckEntry,
  MenuCloseReason,
  MenuEntry,
  MenuRadioEntry,
  MenuSelectable,
  MenuSeparatorEntry,
  MenuSubmenuEntry,
} from './menu-model';
export {
  MessageBox,
  messageBoxEscapeResult,
  type MessageBoxButton,
  type MessageBoxIcon,
  type MessageBoxProps,
} from './MessageBox';
export { findMnemonic, mnemonicKeyOf, parseMnemonic, stripMnemonic } from './mnemonic';
export { isModalOpen } from './focus';
export { LayerContext, Portal } from './layer';
export { RadioGroup, type RadioGroupProps, type RadioOption } from './RadioGroup';
export { Select, type SelectOption, type SelectProps } from './Select';
export { SpinField, type SpinFieldProps } from './SpinField';
export { Splitter, type SplitterProps } from './Splitter';
export { TabPanel, Tabs, tabId, tabPanelId, type TabItem, type TabPanelProps, type TabsProps } from './Tabs';
export { TextField, type TextFieldProps } from './TextField';
export { Toast, ToastStack, type ToastItem, type ToastStackProps } from './Toast';
export { Toolbar, ToolbarSeparator, ToolbarSpacer, type ToolbarProps } from './Toolbar';
export { Tooltip, type TooltipProps } from './Tooltip';
export { VirtualList, type VirtualListHandle, type VirtualListProps } from './VirtualList';
export type { ScrollAlign } from './virtual';
