// Separators whose position is stored in the settings (ARCHITECTURE.md 2.3: "All three separators
// can be dragged. Double-click on a separator restores the default split."; 3.10
// `layout.splits`). Owner: W3.
//
// The stored value is the fraction of the container that the SIZED pane takes, so a layout
// survives a different window size. `useSplit` gives the size in px for a container and the
// properties of the component kit's Splitter; `SplitPane` is two panes with such a separator.

import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useAppContext, useAppState } from '../../state/context';
import { splitFraction, splitPixels, withSplit, type SplitId } from '../../state/layout';
import { Splitter } from '../components';

/** The width and height of an element, kept current. { 0, 0 } before the first measurement. */
export function useElementSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      setSize((previous) =>
        previous.width === box.width && previous.height === box.height
          ? previous
          : { width: box.width, height: box.height },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export interface Split {
  /** CSS flex-basis of the sized pane: px once the container is measured, a percentage before. */
  basis: string;
  /** Properties for the Splitter that moves this separator. */
  bar: { value: number; min: number; max: number; defaultValue: number; onChange(value: number): void };
}

/** The separator `splitId` in a container that is `available` px long in its direction. */
export function useSplit(splitId: SplitId, available: number): Split {
  const ctx = useAppContext();
  const pixels = useAppState(
    (state) => splitPixels(state.settings, splitId, available),
    (a, b) => a.value === b.value && a.min === b.min && a.max === b.max && a.defaultValue === b.defaultValue,
  );
  const fraction = useAppState((state) => splitFraction(state.settings, splitId));
  return {
    basis: available > 0 ? `${pixels.value}px` : `${(fraction * 100).toFixed(2)}%`,
    bar: {
      ...pixels,
      onChange(value) {
        if (available > 0) ctx.settings.update((settings) => withSplit(settings, splitId, value / available));
      },
    },
  };
}

export interface SplitPaneProps {
  splitId: SplitId;
  /** 'vertical': side by side with a vertical bar; 'horizontal': one above the other. */
  orientation: 'vertical' | 'horizontal';
  /** Which pane the stored fraction sizes. */
  sized: 'first' | 'second';
  first: ReactNode;
  second: ReactNode;
  /** Accessible name of the separator, for example 'Resize the Messages panel'. */
  label: string;
  className?: string;
}

export function SplitPane({ splitId, orientation, sized, first, second, label, className }: SplitPaneProps) {
  const container = useRef<HTMLDivElement>(null);
  const size = useElementSize(container);
  const split = useSplit(splitId, orientation === 'vertical' ? size.width : size.height);
  const sizedStyle = { flexBasis: split.basis };
  return (
    <div
      ref={container}
      className={['e68-split', `e68-split--${orientation}`, className ?? ''].filter(Boolean).join(' ')}
      data-split={splitId}
    >
      <div
        className={`e68-split__pane e68-split__pane--${sized === 'first' ? 'sized' : 'rest'}`}
        style={sized === 'first' ? sizedStyle : undefined}
      >
        {first}
      </div>
      <Splitter orientation={orientation} invert={sized === 'second'} label={label} {...split.bar} />
      <div
        className={`e68-split__pane e68-split__pane--${sized === 'second' ? 'sized' : 'rest'}`}
        style={sized === 'second' ? sizedStyle : undefined}
      >
        {second}
      </div>
    </div>
  );
}
