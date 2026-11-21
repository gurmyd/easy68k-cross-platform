// An icon from the sprite icons.svg (ARCHITECTURE.md 2.8). Owner: W2.
//
// The sprite is put into the document once, hidden, the first time an icon
// mounts, and every icon refers to its symbol by fragment (#e68-icon-name).
// A fragment reference works the same under http(s), file: and the desktop
// app's app:// protocol and needs nothing from the content security policy.

import { useLayoutEffect } from 'react';
import spriteSource from './icons.svg?raw';
import { iconId, type IconName } from './icons';

export interface IconProps {
  name: IconName;
  /** Pixel size; the icons are drawn for 16. */
  size?: number;
  /** Accessible name. Without one the icon is decorative (aria-hidden). */
  label?: string;
  className?: string;
}

const SPRITE_ID = 'e68-icon-sprite';

/** Inserts the sprite into the document if it is not there yet. */
export function ensureIconSprite(doc: Document = document): void {
  if (doc.getElementById(SPRITE_ID)) return;
  const parsed = new DOMParser().parseFromString(spriteSource, 'image/svg+xml').documentElement;
  const sprite = doc.importNode(parsed, true) as unknown as SVGSVGElement;
  sprite.id = SPRITE_ID;
  sprite.setAttribute('aria-hidden', 'true');
  sprite.setAttribute('focusable', 'false');
  sprite.setAttribute('width', '0');
  sprite.setAttribute('height', '0');
  sprite.style.position = 'absolute';
  sprite.style.width = '0';
  sprite.style.height = '0';
  sprite.style.overflow = 'hidden';
  doc.body.prepend(sprite);
}

export function Icon({ name, size = 16, label, className }: IconProps) {
  useLayoutEffect(() => ensureIconSprite(), []);
  const labelled = label !== undefined && label !== '';
  return (
    <svg
      className={className ? `e68-icon ${className}` : 'e68-icon'}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      focusable="false"
      {...(labelled ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    >
      <use href={`#${iconId(name)}`} />
    </svg>
  );
}
