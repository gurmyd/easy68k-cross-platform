// Tool-tip (ARCHITECTURE.md 2.8, 2.11). Owner: W2.
//
// Shows `text` near the wrapped element after a short delay on hover and on
// keyboard focus; hides on leave, blur, a press, Escape and scrolling. Once one
// tool-tip has been shown, moving to a neighbour shows the next at once, as
// desktop toolbars do. The text is not part of the accessible name: buttons
// carry their hint as aria-label (2.11). Pass `describes` to link it to the
// child as a description instead (aria-describedby).

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import '../../styles/components.css';
import './Tooltip.css';
import { Portal } from './layer';
import { placePopup } from './position';

export interface TooltipProps {
  text: ReactNode;
  children: ReactNode;
  /** Delay before the first tool-tip shows, in ms. */
  delay?: number;
  /** Link the tool-tip to the child as its description (aria-describedby). */
  describes?: boolean;
  /** Keep it shown (gallery and tests). */
  forceOpen?: boolean;
}

/** Time after a tool-tip hides during which the next one shows without delay. */
const WARM_MS = 500;
let lastHiddenAt = -Infinity;

export function Tooltip({ text, children, delay = 600, describes = false, forceOpen = false }: TooltipProps) {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const shown = open || forceOpen;

  const clear = () => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  const show = useCallback(() => {
    clear();
    const warm = performance.now() - lastHiddenAt < WARM_MS;
    if (warm) setOpen(true);
    else timer.current = window.setTimeout(() => setOpen(true), delay);
  }, [delay]);
  const hide = useCallback(() => {
    clear();
    setOpen((was) => {
      if (was) lastHiddenAt = performance.now();
      return false;
    });
  }, []);

  useEffect(() => clear, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    const onScroll = () => hide();
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, hide]);

  const child =
    describes && isValidElement(children)
      ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, { 'aria-describedby': `${id}-text` })
      : children;

  return (
    <span
      ref={anchorRef}
      className="e68-tooltip__anchor"
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') show();
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(event) => {
        // Keyboard focus only: a click also focuses, and must not open it.
        if ((event.target as Element).matches(':focus-visible')) show();
      }}
      onBlur={hide}
    >
      {child}
      {describes && (
        <span id={`${id}-text`} className="e68-sr">
          {text}
        </span>
      )}
      {shown && (
        <Portal>
          <TooltipBubble id={id} anchorRef={anchorRef}>
            {text}
          </TooltipBubble>
        </Portal>
      )}
    </span>
  );
}

function TooltipBubble({
  id,
  anchorRef,
  children,
}: {
  id: string;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const target = anchor?.firstElementChild ?? anchor;
    const bubble = ref.current;
    if (!target || !bubble) return;
    const box = target.getBoundingClientRect();
    setPosition(
      placePopup(
        { x: box.left, y: box.top, width: box.width, height: box.height },
        { width: bubble.offsetWidth, height: bubble.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        'tooltip',
      ),
    );
  }, [anchorRef]);
  return (
    <div
      ref={ref}
      id={id}
      role="tooltip"
      className="e68-tooltip"
      style={position ? { left: position.x, top: position.y } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {children}
    </div>
  );
}
