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
  GroupBox,
  IconButton,
  ListBox,
  MaskedField,
  Menu,
  MenuBar,
  MessageBox,
  messageBoxDefaultIndex,
  RadioGroup,
  REGISTER_FIELD,
  Select,
  SpinField,
  Splitter,
  SR_FIELD,
  TabPanel,
  Tabs,
  TextArea,
  TextField,
  ToastStack,
  toastLayout,
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

  // docs/requests/N5-default-button.md: MessageBoxRequest.defaultButton names the default button.
  const defaultOf = (out: string): string | undefined =>
    /<button[^>]*data-e68-default="true"[^>]*>(.*?)<\/button>/.exec(out)?.[1]?.replace(/<[^>]+>/g, '');

  it('makes the first button the default when nothing else is asked (as before)', () => {
    const out = html(<MessageBox title="Q" text="t" icon="warning" buttons={['Yes', 'No']} onResult={noop} />);
    expect(out.match(/data-e68-default="true"/g)).toHaveLength(1);
    expect(defaultOf(out)).toBe('Yes');
  });

  it('makes the named button the default: No for the question of P3.3.4', () => {
    const buttons = ['Yes', 'No'] as const;
    const out = html(
      <MessageBox
        title="Q"
        text="t"
        icon="warning"
        buttons={buttons}
        defaultButton={messageBoxDefaultIndex(buttons, 'No')}
        onResult={noop}
      />,
    );
    expect(out.match(/data-e68-default="true"/g)).toHaveLength(1);
    expect(defaultOf(out)).toBe('No');
  });

  it("messageBoxDefaultIndex: the caption's position, else the first button", () => {
    expect(messageBoxDefaultIndex(['Yes', 'No'], undefined)).toBe(0);
    expect(messageBoxDefaultIndex(['Yes', 'No'], 'Yes')).toBe(0);
    expect(messageBoxDefaultIndex(['Yes', 'No'], 'No')).toBe(1);
    expect(messageBoxDefaultIndex(['Yes', 'No', 'Cancel'], 'Cancel')).toBe(2);
    expect(messageBoxDefaultIndex(['Yes', 'No'], 'OK')).toBe(0);
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
    // Only the selected tab names its panel: the other panels are not rendered (2.11, ARIA tabs pattern).
    expect(out).toMatch(/id="docs-tab-a" role="tab" aria-selected="false" (?![^>]*aria-controls)[^>]*>/);
    expect(out).toMatch(
      /id="docs-tab-b" role="tab" aria-selected="true" aria-controls="docs-panel-b"[^>]*tabindex="0"/,
    );
    for (const [, id] of out.matchAll(/aria-controls="([^"]+)"/g)) expect(out).toContain(`id="${id}"`);
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

  it('DataGrid with a height: the grid itself scrolls, header captions are verbatim (gate I2)', () => {
    const grid = (height?: number | string) =>
      html(
        <DataGrid
          label="Memory breakpoints"
          columns={[{ id: 'line', header: 'Line ' }]}
          rows={[{ line: 1 }]}
          rowKey={(_row, i) => String(i)}
          selectedRow={0}
          onSelectRow={noop}
          {...(height !== undefined ? { height } : {})}
        />,
      );
    const tall = grid(132);
    // The height goes to the grid element (the one that holds the focus) as a custom property,
    // and to the rows' area as its least height; the body has no height of its own to scroll in.
    expect(tall).toMatch(/role="grid"[^>]*data-height=""[^>]*style="--e68-grid-body-h:132px"/);
    expect(tall).toContain('class="e68-grid__body" style="min-height:132px"');
    expect(grid('6em')).toContain('--e68-grid-body-h:6em');
    expect(grid()).not.toContain('data-height');
    expect(tall).toContain('>Line </div>');
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

  it('a long action caption puts the action under the text (toastLayout; FS2 at gate I2)', () => {
    expect(toastLayout({})).toBe('inline');
    expect(toastLayout({ action: { label: 'Simulator', run: noop } })).toBe('inline');
    expect(toastLayout({ action: { label: '&Reload', run: noop } })).toBe('inline');
    expect(toastLayout({ action: { label: 'Open the containing folder...', run: noop } })).toBe('stacked');
    const out = html(
      <ToastStack
        toasts={[
          { id: 1, text: 'Linked', action: { label: 'Open the containing folder...', run: noop } },
          { id: 2, text: 'A new version is available.', action: { label: 'Reload', run: noop } },
        ]}
        onDismiss={noop}
      />,
    );
    expect(out).toMatch(/class="e68-toast e68-toast--information" data-layout="stacked"/);
    expect(out).toMatch(/class="e68-toast e68-toast--information" data-layout="inline"/);
    expect(out.match(/e68-toast__action/g)).toHaveLength(2);
    expect(out.match(/e68-toast__close/g)).toHaveLength(2);
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

describe('GroupBox, Dialog footer and field labels (gate I2)', () => {
  it('GroupBox is a fieldset named by its verbatim caption, with its access key', () => {
    const out = html(
      <GroupBox caption="&Color  Group" layout="row" className="x">
        <span>inside</span>
      </GroupBox>,
    );
    expect(out).toContain('<fieldset class="e68-groupbox e68-groupbox--row x" data-e68-mnemonic="c">');
    expect(out).toContain(
      '<legend class="e68-groupbox__caption"><span class="e68-mnemonic">C</span>olor  Group</legend>',
    );
    expect(out).toContain('<span>inside</span>');
    const plain = html(
      <GroupBox caption="Effects" disabled>
        x
      </GroupBox>,
    );
    expect(plain).toContain('<fieldset class="e68-groupbox e68-groupbox--column" disabled="">');
    expect(plain).not.toContain('data-e68-mnemonic');
  });

  it('Dialog footerAlign center marks the button row; the default adds nothing', () => {
    const dialog = (align?: 'end' | 'center') =>
      html(
        <Dialog
          title="Assembler Status - a.X68"
          inline
          {...(align ? { footerAlign: align } : {})}
          footer={<Button caption="Close" />}
        >
          x
        </Dialog>,
      );
    expect(dialog('center')).toContain('<div class="e68-dialog__footer" data-align="center">');
    expect(dialog()).toContain('<div class="e68-dialog__footer">');
    expect(dialog('end')).toContain('<div class="e68-dialog__footer">');
  });

  it('TextArea: a framed textarea, no wrapping by default, its label and access key', () => {
    const out = html(<TextArea label="&Template:" value={'*-----\n*  Title'} onChange={noop} height={260} monospace />);
    expect(out).toContain('class="e68-field e68-textarea" style="height:260px"');
    expect(out).toMatch(/<textarea[^>]*class="e68-textarea__input e68-field__input--mono"/);
    expect(out).toMatch(/<textarea[^>]*wrap="off"/);
    expect(out).toMatch(/<textarea[^>]*spellcheck="false"/i);
    expect(out).toMatch(/<textarea[^>]*data-e68-mnemonic="t"/);
    expect(out).toContain('class="e68-field-label e68-field-label--top"');
    expect(out).toContain('*  Title</textarea>');
    const bare = html(<TextArea aria-label="Template" value="" onChange={noop} disabled wrap="soft" />);
    expect(bare).not.toContain('<label');
    expect(bare).toContain('data-disabled="true"');
    expect(bare).toMatch(/<textarea[^>]*wrap="soft"/);
    expect(bare).toMatch(/<textarea[^>]*aria-label="Template"/);
  });

  it('TextField labelWidthCh gives a left label a least width', () => {
    const out = html(<TextField label="Fi&nd what:" labelWidthCh={11} value="" onChange={noop} />);
    expect(out).toContain('class="e68-field-label__text" style="min-width:11ch"');
    const top = html(<TextField label="Find:" labelPosition="top" labelWidthCh={11} value="" onChange={noop} />);
    expect(top).not.toContain('min-width:11ch');
  });
});
