// Markup of every component, rendered on the server (unit tests run without a
// DOM, ARCHITECTURE.md 0 rule 5): roles, names and states of 2.11. The
// keyboard behaviour in a real browser is checked by gallery/check-gallery.mjs.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Button,
  Checkbox,
  DataGrid,
  Dialog,
  IconButton,
  ListBox,
  MaskedField,
  Menu,
  MenuBar,
  MessageBox,
  RadioGroup,
  REGISTER_FIELD,
  Select,
  SpinField,
  Splitter,
  SR_FIELD,
  TabPanel,
  Tabs,
  TextField,
  ToastStack,
  Toolbar,
  ToolbarSeparator,
  Tooltip,
  VirtualList,
  type MenuEntry,
} from './index';

const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);
const noop = () => {};

describe('Button and IconButton', () => {
  it('renders a typed button with its access key underlined', () => {
    const out = html(<Button caption="&Execute" isDefault onClick={noop} />);
    expect(out).toContain('type="button"');
    expect(out).toContain('data-e68-default="true"');
    expect(out).toContain('data-e68-mnemonic="e"');
    expect(out).toContain('<span class="e68-mnemonic">E</span>xecute');
    expect(out).toContain('e68-button--primary');
  });

  it('gives an icon button its hint as accessible name and a toggle state', () => {
    const out = html(<IconButton icon="run" label="Run (F9)" pressed={false} />);
    expect(out).toContain('aria-label="Run (F9)"');
    expect(out).toContain('aria-pressed="false"');
    expect(out).toContain('href="#e68-icon-run"');
    expect(out).toContain('aria-hidden="true"');
  });
});

describe('Toolbar', () => {
  it('is a labelled toolbar with vertical separators', () => {
    const out = html(
      <Toolbar label="Editor toolbar">
        <IconButton icon="file-new" label="New" />
        <ToolbarSeparator />
        <IconButton icon="file-open" label="Open" />
      </Toolbar>,
    );
    expect(out).toMatch(/^<div role="toolbar" aria-label="Editor toolbar" aria-orientation="horizontal"/);
    expect(out).toContain('role="separator" aria-orientation="vertical"');
  });
});

const fileMenu: MenuEntry[] = [
  { type: 'item', id: 'open', caption: '&Open File...', shortcut: 'Ctrl+O' },
  { type: 'separator' },
  { type: 'check', id: 'wrap', caption: 'Output Window Text &Wrap', checked: true },
  { type: 'radio', id: 'size0', caption: '640x480', checked: false },
  { type: 'item', id: 'printer', caption: 'Printer Setup...', disabled: true },
  { type: 'submenu', id: 'size', caption: 'Output Window &Size', items: [] },
];

describe('MenuBar and Menu', () => {
  it('renders a menubar of menu titles with one tab stop', () => {
    const out = html(
      <MenuBar
        label="Editor"
        menus={[
          { id: 'file', caption: '&File', items: fileMenu },
          { id: 'edit', caption: '&Edit', items: [] },
        ]}
      />,
    );
    expect(out).toContain('role="menubar" aria-label="Editor"');
    expect(out.match(/role="menuitem" aria-haspopup="menu" aria-expanded="false"/g)).toHaveLength(2);
    expect(out.match(/tabindex="0"/g)).toHaveLength(1);
    expect(out).toContain('<span class="e68-mnemonic">F</span>ile');
  });

  it('hides the access-key underline when asked (macOS)', () => {
    const out = html(
      <MenuBar label="Editor" showMnemonics={false} menus={[{ id: 'f', caption: '&File', items: [] }]} />,
    );
    expect(out).not.toContain('e68-mnemonic');
  });

  it('renders items with the roles and states of 2.11', () => {
    const out = html(<Menu inline label="File" items={fileMenu} onSelect={noop} onClose={noop} />);
    expect(out).toContain('role="menu" aria-label="File"');
    expect(out).toContain('role="menuitem"');
    expect(out).toContain('role="menuitemcheckbox" tabindex="-1" aria-checked="true"');
    expect(out).toContain('role="menuitemradio" tabindex="-1" aria-checked="false"');
    expect(out).toContain('aria-disabled="true"');
    expect(out).toContain('aria-haspopup="menu" aria-expanded="false"');
    expect(out).toContain('Ctrl+O');
    expect(out).toContain('role="separator"');
  });
});

describe('Dialog and MessageBox', () => {
  it('renders a modal dialog with a labelled title over a backdrop', () => {
    const out = html(
      <Dialog title="Assembler Status - demo.X68" onCancel={noop} footer={<Button caption="&Close" />}>
        body
      </Dialog>,
    );
    expect(out).toMatch(
      /^<div class="e68-dialog__backdrop"><div role="dialog" aria-modal="true" aria-labelledby="([^"]+)"/,
    );
    const titleId = /aria-labelledby="([^"]+)"/.exec(out)?.[1];
    expect(out).toContain(`<h2 id="${titleId}" class="e68-dialog__title">Assembler Status - demo.X68</h2>`);
    expect(out).toContain('aria-label="Close"');
  });

  it('renders a modeless dialog without backdrop or aria-modal, at its anchor', () => {
    const out = html(
      <Dialog title="Find" modal={false} anchor={{ top: 40, right: 16 }} onCancel={noop}>
        body
      </Dialog>,
    );
    expect(out).not.toContain('aria-modal');
    expect(out).not.toContain('backdrop');
    expect(out).toContain('top:40px;right:16px');
  });

  it('renders a message box verbatim, with Escape and the close button only where Windows has them', () => {
    const text = "File modified, do you wish to save 'a.X68' before closing?\n\nSecond  line";
    const out = html(
      <MessageBox title="Confirm" text={text} icon="confirmation" buttons={['Yes', 'No']} onResult={noop} />,
    );
    expect(out).toContain('role="alertdialog"');
    expect(out).toContain('Second  line');
    expect(out).toContain('aria-label="Question"');
    expect(out).not.toContain('aria-label="Close"');
    const describedBy = /aria-describedby="([^"]+)"/.exec(out)?.[1];
    expect(out).toContain(`id="${describedBy}" class="e68-messagebox__text"`);
    const ok = html(<MessageBox title="Information" text="Done" icon="information" buttons={['OK']} onResult={noop} />);
    expect(ok).toContain('aria-label="Close"');
  });
});

describe('Tabs', () => {
  it('renders a tab list whose selected tab is the tab stop', () => {
    const out = html(
      <>
        <Tabs
          idBase="docs"
          label="Documents"
          items={[
            { id: 'a', label: 'prog.X68', modified: true, closable: true, title: 'My Programs/prog.X68' },
            { id: 'b', label: 'prog.L68', closable: true },
          ]}
          selectedId="b"
          onSelect={noop}
          onClose={noop}
        />
        <TabPanel idBase="docs" tabId="b">
          listing
        </TabPanel>
      </>,
    );
    expect(out).toContain('role="tablist" aria-label="Documents"');
    expect(out).toContain('id="docs-tab-a" role="tab" aria-selected="false" aria-controls="docs-panel-a"');
    expect(out).toMatch(/id="docs-tab-b" role="tab" aria-selected="true"[^>]*tabindex="0"/);
    expect(out).toContain('(modified)');
    expect(out).toContain('id="docs-panel-b" role="tabpanel" aria-labelledby="docs-tab-b"');
  });
});

describe('Splitter', () => {
  it('is a focusable separator with its value', () => {
    const out = html(
      <Splitter
        orientation="vertical"
        value={420}
        min={200}
        max={900}
        onChange={noop}
        label="Resize the left column"
      />,
    );
    expect(out).toContain('role="separator" aria-orientation="vertical" aria-label="Resize the left column"');
    expect(out).toContain('aria-valuenow="420" aria-valuemin="200" aria-valuemax="900" tabindex="0"');
  });
});

describe('fields', () => {
  it('MaskedField shows the normalised text with a label and the prefix box', () => {
    const out = html(<MaskedField label="D0=" {...REGISTER_FIELD} value="1F" onChange={noop} prefix="00" />);
    expect(out).toContain('value="1F000000"');
    expect(out).toContain('maxLength="8"');
    expect(out).toContain('class="e68-masked__prefix" aria-hidden="true">00</span>');
    expect(out).toMatch(/<label for="([^"]+)"[^>]*>.*id="\1"/);
    const sr = html(<MaskedField aria-label="SR" {...SR_FIELD} value="0010000000000000" onChange={noop} />);
    expect(sr).toContain('inputMode="numeric"');
    expect(sr).toContain('aria-label="SR"');
  });

  it('TextField, SpinField, Checkbox, RadioGroup and Select are labelled native controls', () => {
    const text = html(<TextField label="Fi&nd what:" value="MOVE" onChange={noop} invalid message="Not found" />);
    expect(text).toContain('aria-invalid="true"');
    expect(text).toContain('data-e68-mnemonic="n"');
    expect(text).toMatch(/aria-describedby="([^"]+)".*id="\1" class="e68-field-message"/);

    const spin = html(<SpinField label="Tab size" value={4} min={1} max={32} onChange={noop} />);
    expect(spin).toContain('role="spinbutton" aria-valuenow="4" aria-valuemin="1" aria-valuemax="32"');

    const check = html(<Checkbox label="&Bit field" checked onChange={noop} />);
    expect(check).toContain('type="checkbox"');
    expect(check).toContain('checked=""');

    const radio = html(
      <RadioGroup
        label="Tab Type"
        value="fixed"
        onChange={noop}
        options={[
          { value: 'assembly', label: '&Assembly' },
          { value: 'fixed', label: '&Fixed' },
        ]}
      />,
    );
    expect(radio).toMatch(/role="radiogroup" aria-labelledby="([^"]+)"/);
    expect(radio.match(/type="radio"/g)).toHaveLength(2);

    const select = html(
      <Select
        label="View"
        value="SS"
        onChange={noop}
        options={['A0', 'US', 'SS'].map((value) => ({ value, label: value }))}
      />,
    );
    expect(select).toContain('<option value="SS" selected="">SS</option>');
  });
});

describe('lists', () => {
  it('ListBox points at the selected option', () => {
    const out = html(
      <ListBox
        label="Element"
        value="comment"
        onChange={noop}
        items={[
          { value: 'code', label: 'Code' },
          { value: 'comment', label: 'Comment' },
        ]}
      />,
    );
    expect(out).toMatch(/role="listbox" tabindex="0" aria-label="Element" aria-activedescendant="([^"]+)"/);
    const active = /aria-activedescendant="([^"]+)"/.exec(out)?.[1];
    expect(out).toContain(`id="${active}" role="option" aria-selected="true"`);
  });

  it('DataGrid is a grid with column headers, row numbers and an active cell', () => {
    const out = html(
      <DataGrid
        label="Messages"
        rowNumbers
        columns={[
          { id: 'line', header: 'Line', width: '64px', mono: true },
          { id: 'text', header: 'Error Message' },
        ]}
        rows={[
          { line: 9, text: 'ERROR: Undefined symbol' },
          { line: 12, text: 'WARNING: Long branch' },
        ]}
        rowKey={(_row, i) => String(i)}
        selectedRow={1}
        onSelectRow={noop}
      />,
    );
    expect(out).toContain('role="grid" aria-label="Messages" aria-rowcount="3" aria-colcount="3"');
    expect(out.match(/role="columnheader"/g)).toHaveLength(3);
    expect(out.match(/role="rowheader"/g)).toHaveLength(2);
    const active = /aria-activedescendant="([^"]+)"/.exec(out)?.[1];
    expect(out).toContain(`id="${active}" role="gridcell"`);
    expect(out).toContain('aria-selected="true"');
  });

  it('VirtualList renders only the first rows before it is measured', () => {
    const out = html(<VirtualList count={100000} rowHeight={18} renderRow={(i) => `row ${i}`} overscan={2} />);
    expect(out).toContain('height:1800000px');
    expect(out).toContain('row 0');
    expect(out).not.toContain('row 10');
  });
});

describe('Toast and Tooltip', () => {
  it('ToastStack is a polite live region', () => {
    const out = html(
      <ToastStack
        toasts={[{ id: 1, text: 'The program is waiting for keyboard input', action: { label: 'Show', run: noop } }]}
        onDismiss={noop}
      />,
    );
    expect(out).toContain('aria-label="Notifications"');
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain('The program is waiting for keyboard input');
    expect(out).toContain('aria-label="Dismiss"');
  });

  it('Tooltip adds nothing to the accessible name and renders no bubble on the server', () => {
    const out = html(
      <Tooltip text="Open File (Ctrl+O)">
        <button type="button">Open</button>
      </Tooltip>,
    );
    expect(out).toBe('<span class="e68-tooltip__anchor"><button type="button">Open</button></span>');
  });
});
