// The component gallery (ARCHITECTURE.md 9.1 W2): every component of the kit
// in every state, in both themes, with the original's content. Owner: W2.
//
// Shown at ?gallery (the entry point routes there, see route.ts) and, for
// development, at /src/ui/components/gallery/gallery.html on the Vite dev
// server. Later packages learn the kit here: each section says what the
// component is for and which rule of the architecture it implements.
// Forced states (hover, pressed, focus) use data-e68-force (components.css).

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { applyThemeSetting, type ThemeSetting } from '../../../styles/theme';
import { Button } from '../Button';
import { Checkbox } from '../Checkbox';
import { ContextMenu, useContextMenu } from '../ContextMenu';
import { DataGrid } from '../DataGrid';
import { Dialog } from '../Dialog';
import { Icon } from '../Icon';
import { IconButton } from '../IconButton';
import { ICON_NAMES } from '../icons';
import { ListBox } from '../ListBox';
import { MaskedField } from '../MaskedField';
import { ADDRESS_FIELD, INTERVAL_FIELD, REGISTER_FIELD, SR_FIELD, formatMaskedValue, parseMaskedText } from '../masked';
import { Menu } from '../Menu';
import { MenuBar } from '../MenuBar';
import type { MenuSelectable } from '../menu-model';
import { MessageBox, type MessageBoxButton, type MessageBoxIcon } from '../MessageBox';
import { RadioGroup } from '../RadioGroup';
import { Select } from '../Select';
import { SpinField } from '../SpinField';
import { Splitter } from '../Splitter';
import { TabPanel, Tabs, type TabItem } from '../Tabs';
import { TextField } from '../TextField';
import { ToastStack, type ToastItem } from '../Toast';
import { Toolbar, ToolbarSeparator, ToolbarSpacer } from '../Toolbar';
import { Tooltip } from '../Tooltip';
import { VirtualList, type VirtualListHandle } from '../VirtualList';
import './gallery.css';
import {
  EDITOR_CONTEXT_MENU,
  EDITOR_MENUS,
  EDITOR_TOOLBAR,
  MESSAGE_ROWS,
  MESSAGE_SAMPLES,
  SIM_OPTIONS_MENU,
  SIM_TOOLBAR,
  SR_FLAGS_CAPTION,
  type ToolSample,
} from './samples';

export interface GalleryProps {
  initialTheme?: ThemeSetting;
}

type Report = (text: string) => void;

const SECTIONS = [
  ['tokens', 'Tokens'],
  ['icons', 'Icons'],
  ['buttons', 'Buttons'],
  ['toolbars', 'Toolbars'],
  ['menus', 'Menus'],
  ['tabs', 'Tabs'],
  ['splitters', 'Splitters'],
  ['fields', 'Fields'],
  ['masked', 'Masked fields'],
  ['choices', 'Choices'],
  ['lists', 'Lists and grids'],
  ['dialogs', 'Dialogs'],
  ['feedback', 'Tool-tips and toasts'],
] as const;

export function Gallery({ initialTheme = 'system' }: GalleryProps) {
  const [theme, setTheme] = useState<ThemeSetting>(initialTheme);
  const [resolved, setResolved] = useState<'light' | 'dark'>('light');
  const [output, setOutput] = useState('Nothing yet.');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastCount = useRef(0);

  useEffect(() => applyThemeSetting(theme, undefined, setResolved), [theme]);

  const report: Report = (text) => setOutput(text);
  const addToast = (toast: Omit<ToastItem, 'id'>) => {
    toastCount.current += 1;
    setToasts((list) => [...list, { ...toast, id: toastCount.current }]);
  };

  return (
    <div className="e68-gallery" data-gallery-ready="true" data-theme-resolved={resolved}>
      <header className="e68-gallery__header">
        <div className="e68-gallery__brand">
          <Icon name="assemble" size={20} />
          <div>
            <h1 className="e68-gallery__title">Component kit</h1>
            <p className="e68-gallery__subtitle">easy68k-mac - design tokens and components (W2)</p>
          </div>
        </div>
        <Toolbar label="Theme" className="e68-gallery__theme">
          <IconButton
            icon="theme-system"
            label="Theme: follow the system"
            pressed={theme === 'system'}
            onClick={() => setTheme('system')}
          />
          <IconButton
            icon="theme-light"
            label="Theme: light"
            pressed={theme === 'light'}
            onClick={() => setTheme('light')}
          />
          <IconButton
            icon="theme-dark"
            label="Theme: dark"
            pressed={theme === 'dark'}
            onClick={() => setTheme('dark')}
          />
        </Toolbar>
      </header>
      <div className="e68-gallery__layout">
        <nav className="e68-gallery__nav" aria-label="Sections">
          <ul>
            {SECTIONS.map(([id, title]) => (
              <li key={id}>
                <a href={`#${id}`}>{title}</a>
              </li>
            ))}
          </ul>
          <p className="e68-gallery__output" data-testid="gallery-output" aria-live="polite">
            <span>Last action</span>
            {output}
          </p>
        </nav>
        <main className="e68-gallery__main">
          <TokensSection resolved={resolved} />
          <IconsSection />
          <ButtonsSection report={report} />
          <ToolbarsSection report={report} />
          <MenusSection report={report} />
          <TabsSection report={report} />
          <SplittersSection />
          <FieldsSection />
          <MaskedSection />
          <ChoicesSection />
          <ListsSection report={report} />
          <DialogsSection report={report} />
          <FeedbackSection report={report} addToast={addToast} />
        </main>
      </div>
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((list) => list.filter((t) => t.id !== id))} />
    </div>
  );
}

// --- Layout helpers -----------------------------------------------------------

function Section({ id, title, intro, children }: { id: string; title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="e68-gallery__section" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="e68-gallery__h2">
        {title}
      </h2>
      <p className="e68-gallery__intro">{intro}</p>
      {children}
    </section>
  );
}

function Specimen({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <figure className={wide ? 'e68-gallery__specimen e68-gallery__specimen--wide' : 'e68-gallery__specimen'}>
      <div className="e68-gallery__stage">{children}</div>
      <figcaption className="e68-gallery__caption">{label}</figcaption>
    </figure>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="e68-gallery__row">{children}</div>;
}

// --- Tokens -------------------------------------------------------------------

const COLOUR_TOKENS = [
  ['--c-bg', 'window background'],
  ['--c-surface', 'panels, dialogs, fields'],
  ['--c-panel', 'toolbars, headers, status bar'],
  ['--c-border', 'separators'],
  ['--c-border-strong', 'field borders'],
  ['--c-text', 'text'],
  ['--c-text-muted', 'secondary text'],
  ['--c-accent', 'focus, active tab, changed registers'],
  ['--c-on-accent', 'text on accent'],
  ['--c-selection', 'selected row, editor selection'],
  ['--c-danger', 'errors'],
  ['--c-warning', 'warnings'],
  ['--c-ok', 'success'],
  ['--c-logging', 'LOGGING label'],
  ['--c-bp-on', 'gutter dot: breakpoint'],
  ['--c-bp-off', 'gutter dot: instruction row'],
  ['--c-stack-reg', 'stack mark: register'],
  ['--c-stack-sp', 'stack mark: stack pointer'],
] as const;

function TokensSection({ resolved }: { resolved: string }) {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    setValues(Object.fromEntries(COLOUR_TOKENS.map(([name]) => [name, style.getPropertyValue(name).trim()])));
  }, [resolved]);
  return (
    <Section
      id="tokens"
      title="Tokens"
      intro={
        <>
          The custom properties of <code>app/src/styles/tokens.css</code> (2.8). Components use nothing else;
          <code> contrast.test.ts</code> checks every pair below against the 4.5:1 and 3:1 rules in both themes. Current
          theme: <strong>{resolved}</strong>.
        </>
      }
    >
      <ul className="e68-gallery__swatches">
        {COLOUR_TOKENS.map(([name, use]) => (
          <li key={name} className="e68-gallery__swatch">
            <span className="e68-gallery__chip" style={{ background: `var(${name})` }} />
            <span className="e68-gallery__swatch-text">
              <code>{name}</code>
              <span className="e68-gallery__muted">{use}</span>
              <code className="e68-gallery__muted">{values[name] ?? ''}</code>
            </span>
          </li>
        ))}
      </ul>
      <Row>
        <Specimen label="Text on the three backgrounds">
          <div className="e68-gallery__stack">
            <div className="e68-gallery__on e68-gallery__on--bg">Text on --c-bg</div>
            <div className="e68-gallery__on e68-gallery__on--surface">Text on --c-surface</div>
            <div className="e68-gallery__on e68-gallery__on--panel">Text on --c-panel</div>
            <div className="e68-gallery__on e68-gallery__on--selection">Text on --c-selection</div>
          </div>
        </Specimen>
        <Specimen label="Muted, accent and status text">
          <div className="e68-gallery__stack">
            <div className="e68-gallery__muted">Secondary text (--c-text-muted)</div>
            <div style={{ color: 'var(--c-accent)' }}>D0=0000002A changed (--c-accent)</div>
            <div style={{ color: 'var(--c-danger)' }}>ERROR: Undefined symbol</div>
            <div style={{ color: 'var(--c-warning)' }}>WARNING: Label too long</div>
            <div style={{ color: 'var(--c-ok)' }}>No errors</div>
          </div>
        </Specimen>
        <Specimen label="Marks that are the same in both themes">
          <div className="e68-gallery__marks">
            <span className="e68-toolbar__logging">LOGGING</span>
            <span className="e68-gallery__stackbyte e68-gallery__stackbyte--reg">10</span>
            <span className="e68-gallery__stackbyte e68-gallery__stackbyte--sp">3C</span>
            <span className="e68-gallery__dot e68-gallery__dot--on" title="Breakpoint" />
            <span className="e68-gallery__dot e68-gallery__dot--off" title="Instruction row" />
          </div>
        </Specimen>
      </Row>
      <Row>
        <Specimen label="Type scale: --font-ui and --font-mono">
          <div style={{ fontSize: 'var(--fs-lg)' }}>15 px --fs-lg Dialog headings</div>
          <div style={{ fontSize: 'var(--fs-md)' }}>13 px --fs-md Body text, menus, fields</div>
          <div style={{ fontSize: 'var(--fs-sm)' }}>12 px --fs-sm Tool-tips, shortcuts, headers</div>
          <div style={{ fontSize: 'var(--fs-xs)' }}>11 px --fs-xs Fine print</div>
          <pre className="e68-gallery__mono">00001000: 10 3C 00 0E 43 F9 00 00 -&lt;--C---</pre>
        </Specimen>
        <Specimen label="Spacing --sp-1 .. --sp-6 and radii">
          <div className="e68-gallery__spacing">
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <span key={n} style={{ width: `var(--sp-${n})` }} title={`--sp-${n}`} />
            ))}
          </div>
          <div className="e68-gallery__radii">
            <span style={{ borderRadius: 'var(--r-sm)' }}>--r-sm</span>
            <span style={{ borderRadius: 'var(--r-md)' }}>--r-md</span>
          </div>
        </Specimen>
      </Row>
    </Section>
  );
}

// --- Icons --------------------------------------------------------------------

function IconsSection() {
  return (
    <Section
      id="icons"
      title="Icons"
      intro={
        <>
          One sprite, <code>icons.svg</code>, 16 px on a 16 px grid, drawn in <code>currentColor</code>. The toolbar
          icons follow the meaning of the original&apos;s <code>Tool*.GIF</code> images. Use{' '}
          <code>&lt;Icon name&gt;</code>; names are typed (<code>IconName</code>).
        </>
      }
    >
      <ul className="e68-gallery__icons">
        {ICON_NAMES.map((name) => (
          <li key={name}>
            <Icon name={name} />
            <Icon name={name} size={32} />
            <code>{name}</code>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// --- Buttons ------------------------------------------------------------------

const STATES = [
  ['Default', undefined],
  ['Hover', 'hover'],
  ['Pressed', 'active'],
  ['Focus', 'focus'],
] as const;

function ButtonsSection({ report }: { report: Report }) {
  return (
    <Section
      id="buttons"
      title="Buttons"
      intro={
        <>
          <code>Button</code> takes the original caption with its <code>&amp;</code> access key. In a dialog,
          <code> isDefault</code> marks the button Enter presses; it is drawn in the accent colour. <code>quiet</code>
          buttons sit in panel strips (Memory&apos;s Copy, Fill, Save).
        </>
      }
    >
      <table className="e68-gallery__matrix">
        <thead>
          <tr>
            <th scope="col">Variant</th>
            {STATES.map(([name]) => (
              <th key={name} scope="col">
                {name}
              </th>
            ))}
            <th scope="col">Disabled</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ['normal', '&Load L68'],
              ['primary', '&Execute'],
              ['quiet', '&Fill'],
            ] as const
          ).map(([variant, caption]) => (
            <tr key={variant}>
              <th scope="row">{variant}</th>
              {STATES.map(([name, force]) => (
                <td key={name}>
                  <Button
                    caption={caption}
                    variant={variant}
                    data-e68-force={force}
                    tabIndex={force ? -1 : undefined}
                    onClick={() => report(`Button ${caption.replace('&', '')} (${variant})`)}
                  />
                </td>
              ))}
              <td>
                <Button caption={caption} variant={variant} disabled />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Row>
        <Specimen label="With an icon; small size">
          <Button caption="&Assemble" icon="assemble" onClick={() => report('Button Assemble')} />
          <Button caption="Clear Cycles" size="small" onClick={() => report('Button Clear Cycles')} />
          <Button caption="&Copy" size="small" variant="quiet" icon="copy" onClick={() => report('Button Copy')} />
        </Specimen>
        <Specimen label="A dialog's button row: default first">
          <Button caption="&OK" isDefault onClick={() => report('Button OK')} />
          <Button caption="C&ancel" onClick={() => report('Button Cancel')} />
          <Button caption="&Help" onClick={() => report('Button Help')} />
        </Specimen>
      </Row>
    </Section>
  );
}

// --- Toolbars -----------------------------------------------------------------

function ToolButtons({ tools, report }: { tools: (ToolSample | 'sep')[]; report: Report }) {
  return (
    <>
      {tools.map((tool, index) =>
        tool === 'sep' ? (
          <ToolbarSeparator key={`sep-${index}`} />
        ) : (
          <IconButton
            key={tool.id}
            icon={tool.icon}
            label={tool.hint}
            disabled={tool.disabled}
            onClick={() => report(`Toolbar: ${tool.hint}`)}
          />
        ),
      )}
    </>
  );
}

function ToolbarsSection({ report }: { report: Report }) {
  return (
    <Section
      id="toolbars"
      title="Toolbars"
      intro={
        <>
          A <code>Toolbar</code> is one tab stop (2.11): Tab enters on the last used button, Left / Right move, Home /
          End jump, disabled buttons are skipped. Each <code>IconButton</code>&apos;s hint is its accessible name and
          its tool-tip.
        </>
      }
    >
      <Specimen label="Editor toolbar (13 buttons, 6 separators, 1.3.2)" wide>
        <Toolbar label="Editor toolbar" data-testid="editor-toolbar">
          <ToolButtons tools={EDITOR_TOOLBAR} report={report} />
        </Toolbar>
      </Specimen>
      <Specimen label="Simulator toolbar with the LOGGING label (1.3.5)" wide>
        <Toolbar label="Simulator toolbar">
          <ToolButtons tools={SIM_TOOLBAR} report={report} />
          <span className="e68-toolbar__logging">LOGGING</span>
          <ToolbarSpacer />
          <IconButton
            icon="fullscreen"
            label="Full screen (Alt+Enter)"
            onClick={() => report('Toolbar: Full screen')}
          />
        </Toolbar>
      </Specimen>
      <Specimen label="IconButton: default, hover, pressed toggle, focus, disabled">
        <div className="e68-gallery__inline">
          <IconButton icon="run" label="Run (default)" tooltip={false} />
          <IconButton icon="run" label="Run (hover)" tooltip={false} data-e68-force="hover" tabIndex={-1} />
          <IconButton icon="auto-trace" label="Auto Trace (on)" pressed tooltip={false} />
          <IconButton icon="run" label="Run (focus)" tooltip={false} data-e68-force="focus" tabIndex={-1} />
          <IconButton icon="run" label="Run (disabled)" disabled />
        </div>
      </Specimen>
    </Section>
  );
}

// --- Menus --------------------------------------------------------------------

function MenusSection({ report }: { report: Report }) {
  const context = useContextMenu();
  const select = (entry: MenuSelectable) => report(`Menu: ${entry.id}`);
  return (
    <Section
      id="menus"
      title="Menus"
      intro={
        <>
          <code>MenuBar</code>, <code>Menu</code> and <code>ContextMenu</code> share one data type (
          <code>MenuEntry</code>). Keys (2.11): Left / Right between menus, Down / Enter / Space open, Up / Down in the
          menu, Right opens a sub-menu, Escape closes, a letter chooses its access key. After a choice the focus goes
          back where it was, then the command runs.
        </>
      }
    >
      <Specimen label="The editor's menu bar - try it with the keyboard" wide>
        <div className="e68-gallery__menubar" data-testid="editor-menubar">
          <MenuBar label="Editor" menus={EDITOR_MENUS} onSelect={select} />
        </div>
      </Specimen>
      <Row>
        <Specimen label="Menu (in place): checks, a disabled item, a sub-menu of radio items">
          <Menu inline label="Options" items={SIM_OPTIONS_MENU} onSelect={select} onClose={() => undefined} />
        </Specimen>
        <Specimen label="Context menu: right-click, or focus and press Shift+F10">
          <button type="button" className="e68-gallery__context" data-testid="context-target" {...context.triggerProps}>
            Editor text area
            <span className="e68-gallery__muted">right-click here</span>
          </button>
          <ContextMenu label="Editor" items={EDITOR_CONTEXT_MENU} onSelect={select} {...context.menuProps} />
        </Specimen>
      </Row>
    </Section>
  );
}

// --- Tabs ---------------------------------------------------------------------

const DOCUMENTS: TabItem[] = [
  { id: 'demo', label: 'demo.X68', title: 'My Programs/demo/demo.X68', modified: true, closable: true },
  { id: 'macros', label: 'macros.X68', title: 'My Programs/demo/macros.X68', closable: true },
  { id: 'listing', label: 'demo.L68', title: 'My Programs/demo/demo.L68', closable: true },
];

const TOOLS: TabItem[] = [
  { id: 'memory', label: 'Memory', closable: true },
  { id: 'stack', label: 'Stack', closable: true },
  { id: 'hardware', label: 'Hardware', closable: true },
  { id: 'breakpoints', label: 'Break Points', closable: true },
  { id: 'log', label: 'Log', closable: true },
];

function TabsSection({ report }: { report: Report }) {
  const [docs, setDocs] = useState(DOCUMENTS);
  const [doc, setDoc] = useState<string | null>('demo');
  const [tools, setTools] = useState(TOOLS);
  const [tool, setTool] = useState<string | null>('stack');
  const close = (
    list: TabItem[],
    id: string,
    set: (l: TabItem[]) => void,
    selected: string | null,
    select: (v: string | null) => void,
  ) => {
    const index = list.findIndex((t) => t.id === id);
    const next = list.filter((t) => t.id !== id);
    set(next);
    if (selected === id) select(next[index]?.id ?? next[index - 1]?.id ?? null);
    report(`Tab closed: ${id}`);
  };
  return (
    <Section
      id="tabs"
      title="Tabs"
      intro={
        <>
          Document tabs of the editor (a dot marks a modified document; the tool-tip is the full path, 2.4) and the
          simulator&apos;s tool tabs (2.3). Left / Right move and select, Home / End, Delete closes; the <code>x</code>{' '}
          is for the mouse, so the tab list contains only tabs.
        </>
      }
    >
      <Specimen label="Document tabs" wide>
        <Tabs
          idBase="gallery-docs"
          label="Documents"
          items={docs}
          selectedId={doc}
          onSelect={setDoc}
          onClose={(id) => close(docs, id, setDocs, doc, setDoc)}
          end={
            <Button
              size="small"
              variant="quiet"
              caption="Reset"
              onClick={() => {
                setDocs(DOCUMENTS);
                setDoc('demo');
              }}
            />
          }
        />
        {doc && (
          <TabPanel idBase="gallery-docs" tabId={doc} className="e68-gallery__tabpanel">
            <pre className="e68-gallery__mono">{`*-----------------------------------------------------------\n* Title      : ${doc}\n*-----------------------------------------------------------\n    ORG    $1000\nSTART:                  ; first instruction of program`}</pre>
          </TabPanel>
        )}
      </Specimen>
      <Specimen label="Tool tabs" wide>
        <Tabs
          idBase="gallery-tools"
          label="Tools"
          variant="tool"
          items={tools}
          selectedId={tool}
          onSelect={setTool}
          onClose={(id) => close(tools, id, setTools, tool, setTool)}
          end={
            <Button
              size="small"
              variant="quiet"
              caption="Reset"
              onClick={() => {
                setTools(TOOLS);
                setTool('stack');
              }}
            />
          }
        />
        {tool && (
          <TabPanel idBase="gallery-tools" tabId={tool} className="e68-gallery__tabpanel">
            <span className="e68-gallery__muted">The {tools.find((t) => t.id === tool)?.label} panel.</span>
          </TabPanel>
        )}
      </Specimen>
    </Section>
  );
}

// --- Splitters ----------------------------------------------------------------

function SplittersSection() {
  const [left, setLeft] = useState(260);
  const [top, setTop] = useState(90);
  return (
    <Section
      id="splitters"
      title="Splitters"
      intro={
        <>
          A focusable <code>separator</code>: drag it, or use the arrow keys (Shift for bigger steps), Home / End; Enter
          or a double-click restores the default size (2.3).
        </>
      }
    >
      <Specimen label={`Left and right panes - left is ${left} px (default 260)`} wide>
        <div className="e68-gallery__split e68-gallery__split--row">
          <div className="e68-gallery__pane" style={{ width: left }} id="gallery-left-pane">
            Registers, Listing, Messages
          </div>
          <Splitter
            orientation="vertical"
            value={left}
            min={120}
            max={520}
            defaultValue={260}
            onChange={setLeft}
            label="Resize the left column"
            controls="gallery-left-pane"
          />
          <div className="e68-gallery__pane e68-gallery__pane--fill">Output and tool tabs</div>
        </div>
      </Specimen>
      <Specimen label={`Top and bottom panes - top is ${top} px (default 90)`} wide>
        <div className="e68-gallery__split e68-gallery__split--column">
          <div className="e68-gallery__pane" style={{ height: top }} id="gallery-top-pane">
            Editor
          </div>
          <Splitter
            orientation="horizontal"
            value={top}
            min={40}
            max={150}
            defaultValue={90}
            onChange={setTop}
            label="Resize the editor"
            controls="gallery-top-pane"
          />
          <div className="e68-gallery__pane e68-gallery__pane--fill">Messages</div>
        </div>
      </Specimen>
    </Section>
  );
}

// --- Text fields, spin fields, selects ---------------------------------------------

function FieldsSection() {
  const [find, setFind] = useState('MOVE.B');
  const [path, setPath] = useState('My Programs/demo/demo.X68');
  const [tab, setTab] = useState(4);
  const [font, setFont] = useState(11);
  const [view, setView] = useState('SS');
  const [irq, setIrq] = useState('1');
  const [zoom, setZoom] = useState('fit');
  return (
    <Section
      id="fields"
      title="Fields"
      intro={
        <>
          <code>TextField</code>, <code>SpinField</code> and <code>Select</code> share one frame (
          <code>.e68-field</code>): a 1 px border that meets 3:1, an accent ring while focused. Labels take the
          original&apos;s <code>&amp;</code> access key.
        </>
      }
    >
      <Row>
        <Specimen label="TextField: label left, focus, monospace, read-only, disabled">
          <div className="e68-gallery__stack">
            <TextField label="Fi&nd what:" value={find} onChange={setFind} widthCh={24} />
            <span data-e68-force="focus">
              <TextField label="Focused:" value="ORG $1000" onChange={() => undefined} widthCh={24} tabIndex={-1} />
            </span>
            <TextField label="File:" value={path} onChange={setPath} monospace widthCh={30} />
            <TextField
              label="Read-only:"
              value="C:\EASy68K\demo.X68"
              onChange={() => undefined}
              readOnly
              widthCh={24}
            />
            <TextField label="Disabled:" value="(none)" onChange={() => undefined} disabled widthCh={24} />
          </div>
        </Specimen>
        <Specimen label="TextField: label on top, hint, error">
          <div className="e68-gallery__stack">
            <TextField
              label="&Template file name"
              labelPosition="top"
              value="template.NEW"
              onChange={() => undefined}
              message="Stored with the settings."
            />
            <TextField
              label="&Log file"
              labelPosition="top"
              value="demo.txt?"
              onChange={() => undefined}
              invalid
              message="A file name cannot contain ?"
            />
          </div>
        </Specimen>
      </Row>
      <Row>
        <Specimen label="SpinField: arrows, Page Up / Down, Home / End">
          <div className="e68-gallery__stack">
            <SpinField label="Fixed &tab size:" value={tab} min={1} max={32} onChange={setTab} digits={3} />
            <SpinField label="Font &size:" value={font} min={8} max={18} onChange={setFont} digits={3} />
            <SpinField label="Disabled:" value={4} min={1} max={32} onChange={() => undefined} digits={3} disabled />
          </div>
        </Specimen>
        <Specimen label="Select (native list): Stack view, IRQ level, zoom">
          <div className="e68-gallery__stack">
            <Select
              label="&View"
              value={view}
              onChange={setView}
              monospace
              options={['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'US', 'SS'].map((value) => ({ value, label: value }))}
            />
            <Select
              label="IRQ"
              value={irq}
              onChange={setIrq}
              options={['1', '2', '3', '4', '5', '6', '7', ''].map((value) => ({
                value,
                label: value === '' ? '(empty)' : value,
              }))}
            />
            <Select
              label="Zoom"
              value={zoom}
              onChange={setZoom}
              options={[
                { value: 'fit', label: 'Fit' },
                { value: '100', label: '100%' },
                { value: '200', label: '200%' },
              ]}
            />
            <Select
              label="Disabled"
              value="a"
              onChange={() => undefined}
              disabled
              options={[{ value: 'a', label: 'Courier New' }]}
            />
          </div>
        </Specimen>
      </Row>
    </Section>
  );
}

// --- Masked fields --------------------------------------------------------------

const REGISTER_NAMES = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'];

function MaskedSection() {
  const [regs, setRegs] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = Object.fromEntries(REGISTER_NAMES.map((name) => [name, '00000000']));
    initial.D0 = '0000002A';
    initial.A7 = '01000000';
    initial.US = '00FF0000';
    initial.SS = '01000000';
    initial.PC = '00001000';
    return initial;
  });
  const [sr, setSr] = useState('0010000000000000');
  const [addresses, setAddresses] = useState({ seg: 'E00000', led: 'E00010', sw: 'E00012', pb: 'E00014' });
  const [memAddress, setMemAddress] = useState('001000');
  const [interval, setIntervalText] = useState(formatMaskedValue(1000, INTERVAL_FIELD));
  const [beeps, setBeeps] = useState(0);
  const beep = () => setBeeps((n) => n + 1);
  const setReg = (name: string) => (text: string) => setRegs((all) => ({ ...all, [name]: text }));
  const register = (name: string, testId?: string) => (
    <MaskedField
      key={name}
      label={`${name}=`}
      {...REGISTER_FIELD}
      autoSelect
      value={regs[name] ?? '00000000'}
      onChange={setReg(name)}
      onReject={beep}
      data-testid={testId}
    />
  );
  const srValue = parseMaskedText(sr, 'binary');
  return (
    <Section
      id="masked"
      title="Masked fields"
      intro={
        <>
          <code>MaskedField</code> is the original&apos;s fixed-width edit box with blank character <code>0</code>
          (hardware §2.1, sim-ui §4.1, §4.4): typing overwrites, Backspace and Delete leave a <code>0</code>, the width
          never changes. Register and address fields take hex digits only; SR takes 0 and 1, and Backspace or any other
          key types a <code>0</code> at the caret. A refused key beeps in the original - here it counts.
        </>
      }
    >
      <Specimen label="The Registers panel (REGISTER_FIELD, SR_FIELD)" wide>
        <div className="e68-gallery__registers" data-testid="registers">
          <div className="e68-gallery__reggrid">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="e68-gallery__regrow">
                {register(`D${row}`, row === 0 ? 'reg-d0' : undefined)}
                {register(`D${row + 4}`)}
                {register(`A${row}`)}
                {register(`A${row + 4}`)}
              </div>
            ))}
          </div>
          <div className="e68-gallery__srblock">
            <span />
            <span className="e68-gallery__srflags" aria-hidden="true">
              {SR_FLAGS_CAPTION}
            </span>
            <label htmlFor="gallery-sr" className="e68-gallery__srlabel">
              SR=
            </label>
            <MaskedField
              id="gallery-sr"
              {...SR_FIELD}
              value={sr}
              onChange={setSr}
              onReject={beep}
              data-testid="reg-sr"
              aria-describedby="gallery-sr-help"
            />
            <span id="gallery-sr-help" className="e68-sr">
              Bits from 15 to 0: T, blank, S, blank, blank, three interrupt mask bits, three blanks, X N Z V C
            </span>
          </div>
          <div className="e68-gallery__regrow">
            {(['US', 'SS', 'PC'] as const).map((name) => register(name, name === 'PC' ? 'reg-pc' : undefined))}
          </div>
          <dl className="e68-gallery__readout">
            <div>
              <dt>D0</dt>
              <dd data-testid="readout-d0">{parseMaskedText(regs.D0 ?? '', 'hex')}</dd>
            </div>
            <div>
              <dt>SR</dt>
              <dd data-testid="readout-sr">
                ${formatMaskedValue(srValue, { kind: 'hex', width: 4 })} (S={(srValue >> 13) & 1}, mask=
                {(srValue >> 8) & 7})
              </dd>
            </div>
            <div>
              <dt>Beeps</dt>
              <dd data-testid="beep-count">{beeps}</dd>
            </div>
          </dl>
        </div>
      </Specimen>
      <Row>
        <Specimen label="Hardware addresses with the '00' decoration (ADDRESS_FIELD)">
          <div className="e68-gallery__stack e68-gallery__stack--right">
            <MaskedField
              label="7-Segment"
              {...ADDRESS_FIELD}
              prefix="00"
              value={addresses.seg}
              onChange={(seg) => setAddresses((a) => ({ ...a, seg }))}
              onReject={beep}
              data-testid="hw-seg"
            />
            <MaskedField
              label="LEDs"
              {...ADDRESS_FIELD}
              prefix="00"
              value={addresses.led}
              onChange={(led) => setAddresses((a) => ({ ...a, led }))}
              onReject={beep}
            />
            <MaskedField
              label="Switches"
              {...ADDRESS_FIELD}
              prefix="00"
              value={addresses.sw}
              onChange={(sw) => setAddresses((a) => ({ ...a, sw }))}
              onReject={beep}
            />
            <MaskedField
              label="Push Buttons"
              {...ADDRESS_FIELD}
              prefix="00"
              value={addresses.pb}
              onChange={(pb) => setAddresses((a) => ({ ...a, pb }))}
              onReject={beep}
            />
          </div>
        </Specimen>
        <Specimen label="Memory address, interval (INTERVAL_FIELD, decimal), read-only, disabled">
          <div className="e68-gallery__stack e68-gallery__stack--right">
            <MaskedField
              label="&Address:"
              {...ADDRESS_FIELD}
              prefix="$00"
              value={memAddress}
              onChange={setMemAddress}
              onReject={beep}
            />
            <span className="e68-gallery__inline">
              <MaskedField
                label="Auto Interval"
                {...INTERVAL_FIELD}
                value={interval}
                onChange={setIntervalText}
                onReject={beep}
                data-testid="hw-interval"
              />
              <span>mS = {parseMaskedText(interval, 'decimal')} ms</span>
            </span>
            <MaskedField label="Read-only" {...REGISTER_FIELD} value="00FF0000" onChange={() => undefined} readOnly />
            <MaskedField label="Disabled" {...REGISTER_FIELD} value="00000000" onChange={() => undefined} disabled />
          </div>
        </Specimen>
      </Row>
    </Section>
  );
}

// --- Check boxes and radio buttons -----------------------------------------------

function ChoicesSection() {
  const [checks, setChecks] = useState({ listing: true, symbols: false, bitfield: true });
  const [tabType, setTabType] = useState<'assembly' | 'fixed'>('assembly');
  const [zoom, setZoom] = useState<'fit' | '100' | '200'>('fit');
  return (
    <Section
      id="choices"
      title="Choices"
      intro={
        <>
          <code>Checkbox</code> and <code>RadioGroup</code> wrap native inputs, so focus, clicks on the caption and
          screen readers behave as in the platform. A radio group is one tab stop; the arrows move and select.
        </>
      }
    >
      <Row>
        <Specimen label="Checkbox: off, on, hover, focus, disabled">
          <div className="e68-gallery__stack">
            <Checkbox
              label="Generate &Listing file"
              checked={checks.listing}
              onChange={(listing) => setChecks((c) => ({ ...c, listing }))}
              title="Write a .L68 listing"
            />
            <Checkbox
              label="Show &symbol table"
              checked={checks.symbols}
              onChange={(symbols) => setChecks((c) => ({ ...c, symbols }))}
            />
            <span data-e68-force="hover">
              <Checkbox label="Hover" checked={false} onChange={() => undefined} tabIndex={-1} />
            </span>
            <span data-e68-force="focus">
              <Checkbox label="Focus" checked onChange={() => undefined} tabIndex={-1} />
            </span>
            <Checkbox label="Disabled, off" checked={false} onChange={() => undefined} disabled />
            <Checkbox label="Disabled, on" checked onChange={() => undefined} disabled />
          </div>
        </Specimen>
        <Specimen label="RadioGroup: vertical, horizontal, disabled">
          <div className="e68-gallery__stack">
            <RadioGroup
              label="Tab Type"
              value={tabType}
              onChange={setTabType}
              options={[
                { value: 'assembly', label: '&Assembly' },
                { value: 'fixed', label: '&Fixed' },
              ]}
            />
            <RadioGroup
              label="Zoom"
              orientation="horizontal"
              value={zoom}
              onChange={setZoom}
              options={[
                { value: 'fit', label: 'Fit' },
                { value: '100', label: '100%' },
                { value: '200', label: '200%' },
              ]}
            />
            <RadioGroup
              label="Disabled group"
              disabled
              value="a"
              onChange={() => undefined}
              options={[
                { value: 'a', label: 'Checked' },
                { value: 'b', label: 'Not checked' },
              ]}
            />
          </div>
        </Specimen>
      </Row>
    </Section>
  );
}

// --- Lists and grids --------------------------------------------------------------

const ELEMENTS = [
  'Code',
  'Comment',
  'Directive',
  'Label',
  'Macro/Other',
  'Structured',
  'Structure Error',
  'Text',
  'Background',
];

interface Breakpoint {
  reg: string;
  op: string;
  value: string;
  size: string;
  count: string;
}

/** Deterministic memory bytes for the dump: a small program at $1000, $FF elsewhere. */
function memoryByte(address: number): number {
  const program = [0x10, 0x3c, 0x00, 0x0e, 0x43, 0xf9, 0x00, 0x00, 0x10, 0x12, 0x4e, 0x4f, 0xff, 0xff, 0xff, 0xff];
  const text = 'Hello, world!';
  if (address >= 0x1000 && address < 0x1010) return program[address - 0x1000] ?? 0xff;
  if (address >= 0x1012 && address < 0x1012 + text.length) return text.charCodeAt(address - 0x1012);
  return 0xff;
}

function dumpRow(row: number): string {
  const base = row * 16;
  let hex = '';
  let ascii = '';
  for (let i = 0; i < 16; i++) {
    const byte = memoryByte(base + i);
    hex += `${byte.toString(16).toUpperCase().padStart(2, '0')} `;
    ascii += byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '-';
  }
  return `${base.toString(16).toUpperCase().padStart(8, '0')}: ${hex} ${ascii}`;
}

function ListsSection({ report }: { report: Report }) {
  const [element, setElement] = useState<string | null>('Comment');
  const [messageRow, setMessageRow] = useState(0);
  const [bpRow, setBpRow] = useState(0);
  const [editing, setEditing] = useState<{ row: number; column: number } | null>(null);
  const [breakpoints, setBreakpoints] = useState<Breakpoint[]>([
    { reg: 'D0', op: '==', value: '0000002A', size: 'L', count: '1' },
    { reg: 'PC', op: '>=', value: '00001010', size: 'L', count: '3' },
    { reg: 'A7', op: '<', value: '00FF0000', size: 'L', count: '1' },
  ]);
  const [memoryRow, setMemoryRow] = useState(0x100);
  const listRef = useRef<VirtualListHandle>(null);
  const listId = useId();
  const elementItems = useMemo(() => ELEMENTS.map((label) => ({ value: label, label })), []);

  useEffect(() => {
    listRef.current?.scrollToIndex(memoryRow, 'auto');
  }, [memoryRow]);
  // Start with the program at $1000 in the middle of the dump.
  useEffect(() => {
    listRef.current?.scrollToIndex(0x100, 'center');
  }, []);

  return (
    <Section
      id="lists"
      title="Lists and grids"
      intro={
        <>
          <code>ListBox</code> and <code>DataGrid</code> keep the focus on themselves and point at the current item
          (aria-activedescendant). <code>VirtualList</code> renders only the visible rows of a long list; the caller
          adds the semantics - here a 65,536-row memory dump used as a list box.
        </>
      }
    >
      <Row>
        <Specimen label="ListBox: arrows, Page Up / Down, type-ahead">
          <ListBox
            label="Element"
            items={elementItems}
            value={element}
            onChange={setElement}
            rows={6}
            onActivate={(v) => report(`ListBox: ${v} activated`)}
          />
        </Specimen>
        <Specimen label="DataGrid: the editor's message list (2.2); Enter or double-click">
          <DataGrid
            label="Assembler messages"
            columns={[
              { id: 'line', header: 'Line', width: '56px', mono: true, align: 'end' },
              { id: 'text', header: 'Error Message', width: 'minmax(260px, 1fr)' },
            ]}
            rows={MESSAGE_ROWS}
            rowKey={(row) => String(row.line)}
            rowTitle={(row) => row.text}
            selectedRow={messageRow}
            onSelectRow={setMessageRow}
            onActivate={(row) => report(`Go to line ${MESSAGE_ROWS[row]?.line}`)}
            height={5 * 22}
          />
        </Specimen>
      </Row>
      <Row>
        <Specimen label="DataGrid with row numbers and in-place editing (Break Points, 2.6): F2 or double-click">
          <DataGrid
            label="Register breakpoints"
            rowNumbers
            columns={[
              { id: 'reg', header: 'PC/Reg', width: '64px', mono: true },
              { id: 'op', header: 'Operator', width: '72px', mono: true, align: 'center' },
              { id: 'value', header: 'Value', width: '96px', mono: true },
              { id: 'size', header: 'Size', width: '48px', align: 'center' },
              { id: 'count', header: 'Count', width: '56px', align: 'end' },
            ]}
            rows={breakpoints}
            rowKey={(_row, index) => String(index)}
            selectedRow={bpRow}
            onSelectRow={setBpRow}
            onActivate={(row, column) => setEditing({ row, column })}
            editing={editing}
            renderEditor={(row, rowIndex, columnIndex) => {
              const key = (['reg', 'op', 'value', 'size', 'count'] as const)[columnIndex] ?? 'value';
              return (
                <input
                  autoFocus
                  aria-label={`Edit ${key} of row ${rowIndex + 1}`}
                  defaultValue={row[key]}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      const text = event.currentTarget.value;
                      setBreakpoints((list) => list.map((bp, i) => (i === rowIndex ? { ...bp, [key]: text } : bp)));
                      setEditing(null);
                      report(`Breakpoint ${rowIndex + 1}: ${key} = ${text}`);
                    } else if (event.key === 'Escape') {
                      event.stopPropagation();
                      setEditing(null);
                    }
                  }}
                  onBlur={() => setEditing(null)}
                />
              );
            }}
          />
        </Specimen>
        <Specimen label="Empty grid">
          <DataGrid
            label="Empty message list"
            columns={[
              { id: 'line', header: 'Line', width: '56px' },
              { id: 'text', header: 'Error Message' },
            ]}
            rows={[]}
            rowKey={() => ''}
            selectedRow={-1}
            onSelectRow={() => undefined}
            emptyText="No messages."
            height={66}
          />
        </Specimen>
      </Row>
      <Specimen
        label={`VirtualList: 1 MB of memory, 65,536 rows - row $${(memoryRow * 16).toString(16).toUpperCase().padStart(8, '0')}`}
        wide
      >
        <VirtualList
          ref={listRef}
          count={65536}
          rowHeight={18}
          role="listbox"
          aria-label="Memory"
          tabIndex={0}
          aria-activedescendant={`${listId}-row-${memoryRow}`}
          className="e68-gallery__dump"
          data-testid="memory-list"
          renderRow={(index) => dumpRow(index)}
          rowProps={(index) => ({
            id: `${listId}-row-${index}`,
            role: 'option',
            'aria-selected': index === memoryRow,
            className: index === memoryRow ? 'e68-gallery__dumprow--selected' : undefined,
            onPointerDown: () => setMemoryRow(index),
          })}
          onKeyDown={(event) => {
            const pages: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 };
            const step = pages[event.key];
            if (step === undefined) return;
            event.preventDefault();
            setMemoryRow((row) => Math.min(65535, Math.max(0, row + step)));
          }}
        />
      </Specimen>
    </Section>
  );
}

// --- Dialogs and message boxes -------------------------------------------------------

type OpenDialog = { kind: 'message'; index: number } | { kind: 'modal' } | { kind: 'awkward' } | null;

function DialogsSection({ report }: { report: Report }) {
  const [open, setOpen] = useState<OpenDialog>(null);
  const [nested, setNested] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState('');
  const [options, setOptions] = useState({ listing: true, symbols: false, crossRef: false });
  const [tab, setTab] = useState<string | null>('options');
  const [awkward, setAwkward] = useState({ disabled: false, removed: false, name: '' });
  const message = open?.kind === 'message' ? MESSAGE_SAMPLES[open.index] : undefined;
  return (
    <Section
      id="dialogs"
      title="Dialogs"
      intro={
        <>
          <code>Dialog</code> (2.7): modal dialogs dim the workspace, trap Tab and give the focus back when they close;
          modeless ones float at an anchor. Escape cancels, Enter presses the default button, Alt+letter presses a
          button or ticks a box by its access key. <code>MessageBox</code> keeps the original texts verbatim.
        </>
      }
    >
      <Row>
        <Specimen label="Open the real thing">
          <div className="e68-gallery__stack">
            <Button caption="&Modal dialog..." onClick={() => setOpen({ kind: 'modal' })} data-testid="open-modal" />
            <Button
              caption="Modal dialog with &hidden controls..."
              onClick={() => {
                setAwkward({ disabled: false, removed: false, name: '' });
                setOpen({ kind: 'awkward' });
              }}
              data-testid="open-awkward"
            />
            <Button caption="Modeless &Find dialog" onClick={() => setFindOpen(true)} data-testid="open-find" />
            {MESSAGE_SAMPLES.map((sample, index) => (
              <Button
                key={sample.title}
                caption={`Message box: ${sample.icon}`}
                onClick={() => setOpen({ kind: 'message', index })}
                data-testid={`open-message-${sample.icon}`}
              />
            ))}
          </div>
        </Specimen>
        <Specimen label="A modeless dialog, in place (the simulator's Find, 1.3.5)">
          <Dialog
            inline
            modal={false}
            title="Find"
            onCancel={() => report('Find: Cancel')}
            footer={
              <>
                <Button caption="Find  (F3)" isDefault onClick={() => report('Find: Find  (F3)')} />
                <Button caption="Cancel" onClick={() => report('Find: Cancel')} />
              </>
            }
          >
            <TextField label="Fi&nd what:" value="TRAP" onChange={() => undefined} widthCh={22} />
          </Dialog>
        </Specimen>
      </Row>
      <div className="e68-gallery__messages">
        {MESSAGE_SAMPLES.map((sample) => (
          <MessageBox
            key={sample.title}
            inline
            title={sample.title}
            text={sample.text}
            icon={sample.icon as MessageBoxIcon}
            buttons={sample.buttons as readonly MessageBoxButton[]}
            onResult={(button) => report(`${sample.title}: ${button}`)}
          />
        ))}
      </div>

      {open?.kind === 'modal' && (
        <Dialog
          title="Assembler Options"
          width={460}
          onCancel={() => {
            setOpen(null);
            report('Assembler Options: Cancel');
          }}
          footer={
            <>
              <Button
                caption="&OK"
                isDefault
                onClick={() => {
                  setOpen(null);
                  report('Assembler Options: OK');
                }}
              />
              <Button
                caption="C&ancel"
                onClick={() => {
                  setOpen(null);
                  report('Assembler Options: Cancel');
                }}
              />
              <Button caption="&Question..." onClick={() => setNested(true)} data-testid="open-nested" />
            </>
          }
        >
          <Tabs
            idBase="gallery-asm-options"
            label="Assembler Options pages"
            items={[
              { id: 'options', label: 'Assembler Options' },
              { id: 'template', label: 'Template' },
            ]}
            selectedId={tab}
            onSelect={setTab}
            variant="tool"
          />
          <TabPanel idBase="gallery-asm-options" tabId={tab ?? 'options'} className="e68-gallery__dialogpanel">
            {tab === 'template' ? (
              <TextField label="&File:" value="template.NEW" onChange={() => undefined} widthCh={20} />
            ) : (
              <div className="e68-gallery__stack">
                <Checkbox
                  label="Generate &Listing file"
                  checked={options.listing}
                  onChange={(listing) => setOptions((o) => ({ ...o, listing }))}
                />
                <Checkbox
                  label="Show &symbol table"
                  checked={options.symbols}
                  onChange={(symbols) => setOptions((o) => ({ ...o, symbols }))}
                />
                <Checkbox
                  label="&Cross reference"
                  checked={options.crossRef}
                  onChange={(crossRef) => setOptions((o) => ({ ...o, crossRef }))}
                />
              </div>
            )}
          </TabPanel>
        </Dialog>
      )}
      {open?.kind === 'awkward' && (
        // Controls that cannot take the focus (hidden, in a disabled fieldset) and controls that
        // lose it (disabled or removed when pressed): Tab must pass over them (errata W2 entry 13).
        <Dialog
          title="Hidden controls"
          width={420}
          onCancel={() => setOpen(null)}
          footer={
            <>
              <Button caption="&OK" isDefault onClick={() => setOpen(null)} />
              <Button caption="Cancel" onClick={() => setOpen(null)} />
            </>
          }
        >
          <div className="e68-gallery__stack" data-testid="awkward-body">
            <TextField
              label="&Name:"
              value={awkward.name}
              onChange={(name) => setAwkward((a) => ({ ...a, name }))}
              widthCh={16}
            />
            <button type="button" style={{ visibility: 'hidden' }}>
              Invisible
            </button>
            <fieldset disabled style={{ border: 0, margin: 0, padding: 0 }}>
              <input aria-label="Switched off" defaultValue="off" />
            </fieldset>
            <Button
              caption="&Disable me"
              disabled={awkward.disabled}
              onClick={() => setAwkward((a) => ({ ...a, disabled: true }))}
            />
            {!awkward.removed && (
              <Button caption="&Remove me" onClick={() => setAwkward((a) => ({ ...a, removed: true }))} />
            )}
            <Button caption="&Three" onClick={() => undefined} />
          </div>
        </Dialog>
      )}
      {open?.kind === 'modal' && nested && (
        <MessageBox
          title="Sim68K"
          text={'A message box over a dialog:\nthe focus returns to the dialog afterwards.'}
          icon="information"
          buttons={['OK']}
          onResult={() => setNested(false)}
        />
      )}
      {message && (
        <MessageBox
          title={message.title}
          text={message.text}
          icon={message.icon as MessageBoxIcon}
          buttons={message.buttons as readonly MessageBoxButton[]}
          onResult={(button) => {
            setOpen(null);
            report(`${message.title}: ${button}`);
          }}
        />
      )}
      {findOpen && (
        <Dialog
          title="Find"
          modal={false}
          anchor={{ top: 72, right: 24 }}
          onCancel={() => setFindOpen(false)}
          footer={
            <>
              <Button caption="Find  (F3)" isDefault onClick={() => report(`Find: ${findText}`)} />
              <Button caption="Cancel" onClick={() => setFindOpen(false)} />
            </>
          }
        >
          <TextField label="Fi&nd what:" value={findText} onChange={setFindText} widthCh={22} data-autofocus="" />
        </Dialog>
      )}
    </Section>
  );
}

// --- Tool-tips and toasts --------------------------------------------------------------

function FeedbackSection({ report, addToast }: { report: Report; addToast: (toast: Omit<ToastItem, 'id'>) => void }) {
  return (
    <Section
      id="feedback"
      title="Tool-tips and toasts"
      intro={
        <>
          A <code>Tooltip</code> shows after a short delay on hover and on keyboard focus, and hides on Escape. Toasts
          are short notices in a polite live region, for example when a program waits for input while Editor mode is in
          front (2.10).
        </>
      }
    >
      <Row>
        <Specimen label="Tool-tip: hover or focus the buttons">
          <div className="e68-gallery__inline">
            <IconButton icon="file-open" label="Open File (Ctrl+O)" onClick={() => report('Open')} />
            <Tooltip text="Clears the cycle counter" describes>
              <Button caption="Clear Cycles" size="small" onClick={() => report('Clear Cycles')} />
            </Tooltip>
            <div role="tooltip" className="e68-tooltip e68-gallery__static-tooltip">
              Assemble Source (F9)
            </div>
          </div>
        </Specimen>
        <Specimen label="Toasts: open one live, or see all kinds in place">
          <div className="e68-gallery__stack">
            <Button
              caption="Show a &toast"
              data-testid="show-toast"
              onClick={() =>
                addToast({
                  text: 'The program is waiting for keyboard input',
                  action: { label: 'Simulator', run: () => report('Toast action: switch to Simulator mode') },
                })
              }
            />
            <ToastStack
              inline
              onDismiss={(id) => report(`Toast ${id} dismissed`)}
              toasts={[
                {
                  id: 'i',
                  kind: 'information',
                  text: 'The program is waiting for keyboard input',
                  duration: 0,
                  action: { label: 'Simulator', run: () => undefined },
                },
                { id: 's', kind: 'success', text: 'Assembly complete: no errors', duration: 0 },
                { id: 'w', kind: 'warning', text: 'Output window size limited to 4096 x 4096', duration: 0 },
                { id: 'e', kind: 'error', text: 'demo.X68 could not be saved', duration: 0 },
              ]}
            />
          </div>
        </Specimen>
      </Row>
    </Section>
  );
}
