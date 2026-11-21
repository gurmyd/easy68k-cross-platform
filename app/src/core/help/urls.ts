// Help page paths and their URLs; what a link inside a help page means. Owner: H1.
//
// A page is named by its path below the help folder ("Reference/68ks8e.htm", "Quick Reference.htm"),
// '/' separated, in the letter case of the imported file (tools/import-help.mjs). The Help panel
// shows it in a frame whose address is `<base>help/<encoded path>`; `base` is the address of the
// application's own folder, ending in '/'.

import type { HelpTarget } from './sitemap';

/** Folder of the help below the application's address. */
export const HELP_FOLDER = 'help/';

/** The address of a page: each path segment and the fragment encoded, spaces as %20. */
export function helpUrl(base: string, target: HelpTarget | string): string {
  const { page, fragment } = typeof target === 'string' ? splitTarget(target) : target;
  const path = page
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${base}${HELP_FOLDER}${path}${fragment === '' ? '' : `#${encodeURI(fragment)}`}`;
}

/** "page.htm#part" as a target. */
export function splitTarget(text: string): HelpTarget {
  const hash = text.indexOf('#');
  return hash < 0 ? { page: text, fragment: '' } : { page: text.slice(0, hash), fragment: text.slice(hash + 1) };
}

/** The target as the text `splitTarget` reads. */
export function targetText(target: HelpTarget): string {
  return target.fragment === '' ? target.page : `${target.page}#${target.fragment}`;
}

/**
 * The target an address inside the help folder names, or null when the address is not below
 * `<base>help/`. `url` is absolute (as a frame's location is).
 */
export function targetOfUrl(base: string, url: string): HelpTarget | null {
  const prefix = `${base}${HELP_FOLDER}`;
  if (!url.startsWith(prefix)) return null;
  const rest = url.slice(prefix.length);
  const hash = rest.indexOf('#');
  const path = hash < 0 ? rest : rest.slice(0, hash);
  const fragment = hash < 0 ? '' : rest.slice(hash + 1);
  const decode = (text: string): string => {
    try {
      return decodeURIComponent(text);
    } catch {
      return text;
    }
  };
  return { page: path.split('/').map(decode).join('/'), fragment: decode(fragment) };
}

/** What a link inside a help page leads to. */
export type LinkKind =
  | { kind: 'page'; target: HelpTarget } // another page of the help
  | { kind: 'fragment' } // a place in the page itself: the frame scrolls
  | { kind: 'external'; url: string } // a web address or mail address: the system's browser
  | { kind: 'file'; target: HelpTarget } // a non-page file of the help (the Quick Reference PDF)
  | { kind: 'other' }; // anything else: ignored

const PAGE_FILE = /\.html?$/i;

/**
 * Classifies the `href` of a link in page `current` (as the attribute is written). Relative
 * references are resolved against the page's folder; '\\' counts as '/', as it does in a browser.
 */
export function classifyLink(current: string, href: string): LinkKind {
  const value = href.trim();
  if (value === '') return { kind: 'other' };
  if (value.startsWith('#')) return { kind: 'fragment' };
  if (/^(https?:|mailto:)/i.test(value)) return { kind: 'external', url: value };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return { kind: 'other' };
  const hash = value.indexOf('#');
  const path = (hash < 0 ? value : value.slice(0, hash)).replace(/\\/g, '/');
  const fragment = hash < 0 ? '' : value.slice(hash + 1);
  const folder = current.includes('/') ? current.slice(0, current.lastIndexOf('/')).split('/') : [];
  const parts = [...folder];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (parts.length === 0) return { kind: 'other' }; // leaves the help folder
      parts.pop();
    } else {
      let name = segment;
      try {
        name = decodeURIComponent(segment);
      } catch {
        // keep the segment as written
      }
      parts.push(name);
    }
  }
  const page = parts.join('/');
  if (page === '') return { kind: 'fragment' };
  return PAGE_FILE.test(page)
    ? { kind: 'page', target: { page, fragment } }
    : { kind: 'file', target: { page, fragment } };
}
