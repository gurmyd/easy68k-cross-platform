// The Hardware panel (ARCHITECTURE.md 2.6; hardware §5): the original's "EASy68K Hardware" window as
// a tool panel. Six rows as in the original: 7-segment display, LEDs, bit labels and toggle switches,
// push buttons, the three groups Interrupt / Auto Interval / Reset, and the Memory Map.
//
// The panel draws `HardwareModel.view(engine)` and sends every user action through
// `HardwareModel.actions`, which queues it for the run controller (3.3.3). It re-reads the view at
// most once per display frame: when the model said the view may have changed, and also when the
// displayed memory bytes changed without any host call (the engine's writeBytes, the Memory panel's
// pokes and a load make none).
//
// Owner: W3 > SH7.

import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  ADDRESS_FIELD,
  Checkbox,
  INTERVAL_FIELD,
  MaskedField,
  Select,
  parseMaskedText,
  type MaskedConfig,
} from '../../ui/components';
import { useAppContext } from '../../state/context';
import { displayedBytes } from '../../core/sim-host/hardware/model';
import { HwDevice, type AppContext, type HardwareActions, type HardwareView } from '../../contracts';
import {
  BITS_LEFT_TO_RIGHT,
  ButtonHolds,
  DEVICE_ROWS,
  DIGIT_ORIGINS,
  DISPLAY_SIZE,
  LED_PANEL_SIZE,
  LEVELS_LEFT_TO_RIGHT,
  LEVEL_OPTIONS,
  MAP_ROWS,
  SEGMENTS,
  displayDescription,
  ledDescription,
  ledLeft,
  lit,
  pressesButton,
  syncFieldText,
  viewSignature,
  type DeviceRow,
} from './panel-logic';
import './HardwarePanel.css';

/** The view of the current engine, or null when no engine can be read (yet). */
function readView(ctx: AppContext): HardwareView | null {
  try {
    return ctx.sim.hardware.view(ctx.sim.engine);
  } catch {
    return null;
  }
}

/** The view, refreshed at most once per frame (4.6). */
function useHardwareView(ctx: AppContext): HardwareView | null {
  const [view, setView] = useState<HardwareView | null>(() => readView(ctx));
  const current = useRef(view);
  current.current = view;

  useEffect(() => {
    let dirty = true;
    let signature = current.current ? viewSignature(current.current) : '';
    const markDirty = () => {
      dirty = true;
    };
    /** The bytes on screen differ from memory: a write that caused no host call. */
    const memoryMoved = (): boolean => {
      const shown = current.current;
      if (!shown) return true;
      try {
        const now = displayedBytes(ctx.sim.engine.memory, shown.controls.seg7, shown.controls.led, shown);
        return now.ledByte !== shown.ledByte || now.seg7Bytes.some((byte, i) => byte !== shown.seg7Bytes[i]);
      } catch {
        return false;
      }
    };
    const refresh = () => {
      if (!dirty && !memoryMoved()) return;
      dirty = false;
      const next = readView(ctx);
      if (!next) return;
      const nextSignature = viewSignature(next);
      if (nextSignature === signature) return;
      signature = nextSignature;
      setView(next);
    };
    const offModel = ctx.sim.hardware.subscribe(markDirty);
    const offController = ctx.sim.controller.subscribe(markDirty);
    const offEngine = ctx.sim.onEngineReplaced(markDirty);
    const offFrame = ctx.scheduler.onFrame(refresh);
    refresh();
    return () => {
      offModel();
      offController();
      offEngine();
      offFrame();
    };
  }, [ctx]);
  return view;
}

/** A value the engine owns, shown at once as the user changed it until the engine's value moves. */
function useShownValue<T>(engineValue: T): [T, (value: T) => void] {
  const [state, setState] = useState<{ engine: T; shown: T }>({ engine: engineValue, shown: engineValue });
  if (!Object.is(state.engine, engineValue)) {
    const next = { engine: engineValue, shown: engineValue };
    setState(next);
    return [engineValue, (value) => setState({ engine: engineValue, shown: value })];
  }
  return [state.shown, (value) => setState({ engine: engineValue, shown: value })];
}

/** The text of a masked field over a number the engine owns (panel-logic syncFieldText). */
function useFieldText(value: number, config: MaskedConfig): [string, (text: string) => void] {
  const [state, setState] = useState(() => ({ value, text: syncFieldText('', value, config) }));
  if (state.value !== value) {
    const text = syncFieldText(state.text, value, config);
    setState({ value, text });
    return [text, (next) => setState({ value, text: next })];
  }
  return [state.text, (next) => setState({ value, text: next })];
}

/** Settings key of each device's saved address (sim68K.dat lines, hardware §2.1). */
const SETTINGS_KEY = {
  [HwDevice.Seg7]: 'seg7Address',
  [HwDevice.Led]: 'ledAddress',
  [HwDevice.Switch]: 'switchAddress',
  [HwDevice.PushButton]: 'buttonAddress',
} as const;

export function HardwarePanel() {
  const ctx = useAppContext();
  const view = useHardwareView(ctx);
  const actions = ctx.sim.hardware.actions;
  const root = useRef<HTMLDivElement | null>(null);

  if (!view) {
    return (
      <div className="e68-hw e68-hw--empty" data-e68-panel-focus tabIndex={-1}>
        The simulator is starting.
      </div>
    );
  }

  return (
    <div className="e68-hw" ref={root} data-hw-root>
      <div className="e68-hw__devices">
        <DisplayRow view={view} />
        <AddressCell row={DEVICE_ROWS[0] as DeviceRow} view={view} actions={actions} ctx={ctx} root={root} focus />
        <LedRow view={view} />
        <AddressCell row={DEVICE_ROWS[1] as DeviceRow} view={view} actions={actions} ctx={ctx} root={root} />
        <SwitchRow view={view} actions={actions} />
        <AddressCell row={DEVICE_ROWS[2] as DeviceRow} view={view} actions={actions} ctx={ctx} root={root} />
        <ButtonRow actions={actions} />
        <AddressCell row={DEVICE_ROWS[3] as DeviceRow} view={view} actions={actions} ctx={ctx} root={root} />
      </div>
      <div className="e68-hw__groups">
        <InterruptGroup view={view} actions={actions} />
        <IntervalGroup view={view} actions={actions} />
        <Group caption="Reset" className="e68-hw__group--reset">
          <button
            type="button"
            className="e68-hw__irq"
            aria-label="Reset"
            disabled={!view.buttonsEnabled}
            data-hw-nofocus
            onClick={() => actions.reset()}
          />
        </Group>
      </div>
      <MemoryMapGroup view={view} actions={actions} />
    </div>
  );
}

/* ------------------------------------------------------------------ row 1: 7-segment display */

function DisplayRow({ view }: { view: HardwareView }) {
  return (
    <div className="e68-hw__device">
      <svg
        className="e68-hw__display"
        viewBox={`0 0 ${DISPLAY_SIZE.width} ${DISPLAY_SIZE.height}`}
        width={DISPLAY_SIZE.width}
        height={DISPLAY_SIZE.height}
        role="img"
        aria-label={displayDescription(view.seg7Bytes)}
      >
        {DIGIT_ORIGINS.map((x0, digit) => (
          <g key={digit} data-digit={digit}>
            {SEGMENTS.map((segment) => (
              <rect
                key={segment.name}
                x={x0 + segment.x}
                y={segment.y}
                width={segment.w}
                height={segment.h}
                className={lit(view.seg7Bytes[digit] ?? 0, segment.bit) ? 'e68-hw__lamp--on' : 'e68-hw__lamp--off'}
                data-segment={segment.name}
              />
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ row 2: LEDs */

function LedRow({ view }: { view: HardwareView }) {
  return (
    <div className="e68-hw__device">
      <svg
        className="e68-hw__leds"
        viewBox={`0 0 ${LED_PANEL_SIZE.width} ${LED_PANEL_SIZE.height}`}
        width={LED_PANEL_SIZE.width}
        height={LED_PANEL_SIZE.height}
        role="img"
        aria-label={ledDescription(view.ledByte)}
      >
        {BITS_LEFT_TO_RIGHT.map((bit) => (
          <circle
            key={bit}
            cx={ledLeft(bit) + 8.5}
            cy={8 + 8.5}
            r={7.5}
            className={`e68-hw__led ${lit(view.ledByte, bit) ? 'e68-hw__lamp--on' : 'e68-hw__lamp--off'}`}
            data-led={bit}
          />
        ))}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ row 3: bit labels and switches */

function SwitchRow({ view, actions }: { view: HardwareView; actions: HardwareActions }) {
  return (
    <div className="e68-hw__device e68-hw__device--switches">
      <div className="e68-hw__bits" aria-hidden="true">
        {BITS_LEFT_TO_RIGHT.map((bit) => (
          <span key={bit} className="e68-hw__bit">
            {bit}
          </span>
        ))}
      </div>
      <div className="e68-hw__strip">
        {BITS_LEFT_TO_RIGHT.map((bit) => {
          const on = view.controls.switchOn[bit] === true;
          return (
            <span key={bit} className="e68-hw__slot">
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label={`Switch ${bit}`}
                className="e68-hw__switch"
                data-switch={bit}
                data-on={on ? 'true' : undefined}
                onClick={() => actions.clickSwitch(bit)}
              >
                <SwitchPicture on={on} />
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** A rocker switch, drawn for the port after the original's toggleswitch.bmp (hardware §2.4). */
function SwitchPicture({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 27 44" width="27" height="44" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="25" height="42" rx="2" className="e68-hw__switch-frame" />
      <rect x="5" y={on ? 5 : 20} width="17" height="19" rx="1" className="e68-hw__switch-rocker" />
      <rect x="9" y="30" width="9" height="8" rx="1" className={on ? 'e68-hw__lamp--on' : 'e68-hw__lamp--off'} />
    </svg>
  );
}

/* ------------------------------------------------------------------ row 4: push buttons */

function ButtonRow({ actions }: { actions: HardwareActions }) {
  const [held, setHeld] = useState<ReadonlySet<number>>(() => new Set());
  const holds = useRef<ButtonHolds | null>(null);
  if (!holds.current) {
    holds.current = new ButtonHolds({
      pressButton: (bit) => {
        actions.pressButton(bit);
        setHeld((set) => new Set(set).add(bit));
      },
      releaseButton: (bit) => {
        actions.releaseButton(bit);
        setHeld((set) => {
          const next = new Set(set);
          next.delete(bit);
          return next;
        });
      },
    });
  }
  const tracker = holds.current;

  useEffect(() => {
    // The window loses the focus or the page is hidden while a button is held: release it.
    const releaseAll = () => tracker.releaseAll();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') releaseAll();
    };
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', onVisibility);
      releaseAll();
    };
  }, [tracker]);

  return (
    <div className="e68-hw__device">
      <div className="e68-hw__strip">
        {BITS_LEFT_TO_RIGHT.map((bit) => {
          const pointer = (event: PointerEvent<HTMLButtonElement>) => `pointer:${event.pointerId}`;
          return (
            <span key={bit} className="e68-hw__slot">
              <button
                type="button"
                aria-label={`Push button ${bit}`}
                className="e68-hw__pb"
                data-pb={bit}
                data-held={held.has(bit) ? 'true' : undefined}
                // Every mouse button presses (the original ignores Button).
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture?.(event.pointerId);
                  tracker.press(bit, pointer(event));
                }}
                onPointerUp={(event) => tracker.release(bit, pointer(event))}
                onPointerCancel={(event) => tracker.releaseAll(pointer(event))}
                onLostPointerCapture={(event) => tracker.releaseAll(pointer(event))}
                onContextMenu={(event) => event.preventDefault()}
                onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                  if (!pressesButton(event.key) || event.ctrlKey || event.metaKey) return;
                  event.preventDefault(); // no click from Space or Enter
                  tracker.press(bit, 'key');
                }}
                onKeyUp={(event: KeyboardEvent<HTMLButtonElement>) => {
                  if (!pressesButton(event.key)) return;
                  event.preventDefault();
                  tracker.release(bit, 'key');
                }}
                onBlur={() => tracker.release(bit, 'key')}
              />
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ address fields */

interface AddressCellProps {
  row: DeviceRow;
  view: HardwareView;
  actions: HardwareActions;
  ctx: AppContext;
  root: { current: HTMLElement | null };
  focus?: boolean;
}

function AddressCell({ row, view, actions, ctx, root, focus }: AddressCellProps) {
  const [text, setText] = useFieldText(row.value(view), ADDRESS_FIELD);
  const conflict = view.addressConflict[row.conflict];
  const commit = () => {
    if (row.commits) actions.setAddress(row.device, parseMaskedText(text, 'hex'), true);
  };
  return (
    <div className="e68-hw__address">
      <MaskedField
        label="Address:"
        {...ADDRESS_FIELD}
        prefix="00"
        value={text}
        aria-label={`${row.name} address`}
        aria-invalid={conflict ? 'true' : undefined}
        title={conflict ? 'This address overlaps another device' : undefined}
        className={conflict ? 'e68-hw__field--conflict' : undefined}
        data-hw-address={row.device}
        {...(focus ? { 'data-e68-panel-focus': '' } : {})}
        onChange={(next) => {
          setText(next);
          const address = parseMaskedText(next, 'hex');
          actions.setAddress(row.device, address, false);
          const key = SETTINGS_KEY[row.device];
          ctx.settings.update((settings) =>
            settings.sim[key] === address ? settings : { ...settings, sim: { ...settings.sim, [key]: address } },
          );
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
        onBlur={(event: FocusEvent<HTMLInputElement>) => {
          // OnExit fires when the focus moves to another control of the same form that can take it
          // (hardware §2.4; V12): not for another window and not for the IRQ and Reset buttons.
          const next = event.relatedTarget as HTMLElement | null;
          if (next && root.current?.contains(next) && !next.closest('[data-hw-nofocus]')) commit();
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ row 5: groups */

function Group({ caption, className, children }: { caption: string; className?: string; children: ReactNode }) {
  return (
    <fieldset className={['e68-hw__group', className ?? ''].filter(Boolean).join(' ')}>
      <legend className="e68-hw__legend">{caption}</legend>
      {children}
    </fieldset>
  );
}

function InterruptGroup({ view, actions }: { view: HardwareView; actions: HardwareActions }) {
  return (
    <Group caption={' Interrupt '} className="e68-hw__group--interrupt">
      <div className="e68-hw__levels">
        {LEVELS_LEFT_TO_RIGHT.map((level) => (
          <div key={level} className="e68-hw__level">
            <span className="e68-hw__bit" aria-hidden="true">
              {level}
            </span>
            <button
              type="button"
              className="e68-hw__irq"
              aria-label={`IRQ ${level}`}
              disabled={!view.buttonsEnabled}
              data-irq={level}
              data-hw-nofocus
              onClick={() => actions.requestIrq(level)}
            />
            <AutoCheck level={level} view={view} actions={actions} />
          </div>
        ))}
      </div>
      <div className="e68-hw__auto-label" data-hw-auto-label aria-live="polite">
        {view.autoLabel}
      </div>
    </Group>
  );
}

function AutoCheck({ level, view, actions }: { level: number; view: HardwareView; actions: HardwareActions }) {
  const [checked, setChecked] = useShownValue(view.controls.auto[level]?.checked === true);
  return (
    <Checkbox
      checked={checked}
      aria-label={`Automatic IRQ ${level}`}
      data-auto={level}
      onChange={(value) => {
        setChecked(value);
        actions.setAutoChecked(level, value);
      }}
    />
  );
}

function IntervalGroup({ view, actions }: { view: HardwareView; actions: HardwareActions }) {
  const [text, setText] = useFieldText(view.controls.intervalBox, INTERVAL_FIELD);
  const [level, setLevel] = useShownValue(String(view.controls.selectedAutoIrq));
  return (
    <Group caption="Auto Interval" className="e68-hw__group--interval">
      <div className="e68-hw__line">
        <MaskedField
          {...INTERVAL_FIELD}
          value={text}
          aria-label="Auto interval in milliseconds"
          data-hw-interval
          onChange={(next) => {
            setText(next);
            actions.setAutoInterval(parseMaskedText(next, 'decimal'));
          }}
        />
        <span className="e68-hw__unit">mS</span>
      </div>
      <div className="e68-hw__line">
        <Select
          options={LEVEL_OPTIONS}
          value={level}
          widthCh={3}
          aria-label="IRQ level of the auto interval"
          data-hw-level
          onChange={(value) => {
            setLevel(value);
            actions.selectLevel(Number(value));
          }}
        />
        <span className="e68-hw__unit">{' IRQ'}</span>
      </div>
    </Group>
  );
}

/* ------------------------------------------------------------------ row 6: memory map */

function MemoryMapGroup({ view, actions }: { view: HardwareView; actions: HardwareActions }) {
  return (
    <Group caption="Memory Map" className="e68-hw__group--map">
      <div className="e68-hw__map">
        <span />
        <span className="e68-hw__map-head">Start:</span>
        <span className="e68-hw__map-head">End:</span>
        <span />
        {MAP_ROWS.map((spec) => (
          <MapRowView key={spec.kind} spec={spec} view={view} actions={actions} />
        ))}
      </div>
    </Group>
  );
}

function MapRowView({
  spec,
  view,
  actions,
}: {
  spec: (typeof MAP_ROWS)[number];
  view: HardwareView;
  actions: HardwareActions;
}) {
  const row = view.controls.map[spec.kind] ?? { enabled: false, start: 0, end: 0 };
  const [enabled, setEnabled] = useShownValue(row.enabled);
  const [start, setStart] = useFieldText(row.start, ADDRESS_FIELD);
  const [end, setEnd] = useFieldText(row.end, ADDRESS_FIELD);
  const name = spec.label.replace(':', '');
  return (
    <>
      <Checkbox
        label={spec.label}
        checked={enabled}
        data-map={spec.kind}
        onChange={(value) => {
          setEnabled(value);
          actions.setMap(spec.kind, { enabled: value });
        }}
      />
      <MaskedField
        {...ADDRESS_FIELD}
        prefix="00"
        value={start}
        aria-label={`${name} start`}
        data-map-start={spec.kind}
        onChange={(next) => {
          setStart(next);
          actions.setMap(spec.kind, { start: parseMaskedText(next, 'hex') });
        }}
      />
      <MaskedField
        {...ADDRESS_FIELD}
        prefix="00"
        value={end}
        aria-label={`${name} end`}
        data-map-end={spec.kind}
        onChange={(next) => {
          setEnd(next);
          actions.setMap(spec.kind, { end: parseMaskedText(next, 'hex') });
        }}
      />
      <span className="e68-hw__note">{spec.note}</span>
    </>
  );
}
