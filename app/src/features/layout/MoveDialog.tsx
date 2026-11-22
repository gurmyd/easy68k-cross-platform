// The dialog `layout.move` of `Move Panel To...` (ARCHITECTURE-PLUS P3.1.4). Owner: N1.
//
//   +-- Move Panel -----------------------------------------------+
//   | &Panel:   [ Files              v ]                           |
//   | P&lace:   ( ) Into the group of [ Editor        v ] as a tab |
//   |           ( ) Beside [ Editor        v ]: [ Left  v ]       |
//   |           ( ) At the edge of the window: [ Left  v ]         |
//   |                                          [  OK  ] [ Cancel ] |
//   +--------------------------------------------------------------+
//
// OK returns the move (model.ts resultOf); the command makes it with one FlexLayout action.

import { useId, useRef, useState, type ReactNode } from 'react';
import type { DialogProps } from '../../contracts';
import { Button, Caption, Dialog, Select } from '../../ui/components';
import './layout.css';
import {
  initialChoice,
  otherPanels,
  resultOf,
  withPanel,
  type BesideSide,
  type DescribedPanel,
  type EdgeSide,
  type MoveChoice,
  type MoveResult,
} from './model';
import { BESIDE_SIDE_LABELS, EDGE_SIDE_LABELS, MOVE_TEXTS } from './texts';

export interface MoveDialogProps {
  panels: readonly DescribedPanel[];
  /** The panel the dialog starts on (the focused one, or the command's argument). */
  initial?: string | null;
}

const PLACES: MoveChoice['place'][] = ['tab', 'beside', 'edge'];

export function MoveDialog({ props, close }: DialogProps<MoveDialogProps, MoveResult | null>) {
  const id = useId();
  const first = useRef<HTMLSelectElement>(null);
  const [choice, setChoice] = useState(() => initialChoice(props.panels, props.initial));
  const options = props.panels.map((entry) => ({ value: entry.panel, label: entry.title }));
  const others = otherPanels(props.panels, choice.panel).map((entry) => ({ value: entry.panel, label: entry.title }));
  const result = resultOf(choice);
  const set = (patch: Partial<MoveChoice>) => setChoice((current) => ({ ...current, ...patch }));

  const radio = (place: MoveChoice['place'], children: ReactNode) => (
    <div className="e68-movepanel__row" key={place}>
      <label className="e68-checkbox e68-radio" htmlFor={`${id}-${place}`}>
        <input
          id={`${id}-${place}`}
          type="radio"
          name={`${id}-place`}
          className="e68-checkbox__input"
          checked={choice.place === place}
          // The group's access key (P&lace:) goes to the chosen place.
          data-e68-mnemonic={choice.place === place ? 'l' : undefined}
          onChange={() => set({ place })}
        />
        <span className="e68-checkbox__box e68-radio__circle" aria-hidden="true">
          <span className="e68-radio__dot" />
        </span>
      </label>
      {children}
    </div>
  );

  return (
    <Dialog
      title={MOVE_TEXTS.title}
      initialFocus={first}
      onCancel={() => close(null)}
      footer={
        <>
          <Button
            caption={MOVE_TEXTS.ok}
            isDefault
            disabled={result === null}
            onClick={() => result && close(result)}
          />
          <Button caption={MOVE_TEXTS.cancel} onClick={() => close(null)} />
        </>
      }
    >
      <div className="e68-movepanel">
        <Select
          selectRef={first}
          label={MOVE_TEXTS.panel}
          options={options}
          value={choice.panel}
          onChange={(panel) => setChoice((current) => withPanel(props.panels, current, panel))}
        />
        <div role="radiogroup" aria-labelledby={`${id}-place-label`} className="e68-movepanel__places">
          <span id={`${id}-place-label`} className="e68-movepanel__label">
            <Caption text={MOVE_TEXTS.place} />
          </span>
          <div className="e68-movepanel__choices">
            {PLACES.map((place) => {
              if (place === 'tab') {
                return radio(
                  place,
                  <>
                    <label htmlFor={`${id}-tab`} className="e68-movepanel__text">
                      {MOVE_TEXTS.intoGroup}
                    </label>
                    <Select
                      aria-label={MOVE_TEXTS.intoGroupList}
                      options={others}
                      value={choice.near}
                      disabled={others.length === 0}
                      onChange={(near) => set({ near, place: 'tab' })}
                    />
                    <span className="e68-movepanel__text">{MOVE_TEXTS.asTab}</span>
                  </>,
                );
              }
              if (place === 'beside') {
                return radio(
                  place,
                  <>
                    <label htmlFor={`${id}-beside`} className="e68-movepanel__text">
                      {MOVE_TEXTS.beside}
                    </label>
                    <Select
                      aria-label={MOVE_TEXTS.besideList}
                      options={others}
                      value={choice.near}
                      disabled={others.length === 0}
                      onChange={(near) => set({ near, place: 'beside' })}
                    />
                    <span className="e68-movepanel__text">:</span>
                    <Select
                      aria-label={MOVE_TEXTS.besideSide}
                      options={(Object.keys(BESIDE_SIDE_LABELS) as BesideSide[]).map((side) => ({
                        value: side,
                        label: BESIDE_SIDE_LABELS[side],
                      }))}
                      value={choice.beside}
                      onChange={(beside) => set({ beside, place: 'beside' })}
                    />
                  </>,
                );
              }
              return radio(
                place,
                <>
                  <label htmlFor={`${id}-edge`} className="e68-movepanel__text">
                    {MOVE_TEXTS.edge}
                  </label>
                  <Select
                    aria-label={MOVE_TEXTS.edgeSide}
                    options={(Object.keys(EDGE_SIDE_LABELS) as EdgeSide[]).map((side) => ({
                      value: side,
                      label: EDGE_SIDE_LABELS[side],
                    }))}
                    value={choice.edge}
                    onChange={(edge) => set({ edge, place: 'edge' })}
                  />
                </>,
              );
            })}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
