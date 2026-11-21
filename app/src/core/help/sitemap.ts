// Reader of the HTML Help sitemap files `contents.hhc` (the contents tree) and `index.hhk` (the
// index) of the original help. ARCHITECTURE.md 2.7, 9.2 (H1). Owner: H1.
//
// Both files are the same format: nested `<UL>` lists of `<LI> <OBJECT type="text/sitemap">` entries
// with `<param name="Name" value="...">` and `<param name="Local" value="...">` children. A list that
// follows an entry holds its children. An entry may have several `Name` parameters (in the index the
// first is the keyword and the following ones the titles of the topics) and no `Local` (a book that
// only groups).

export interface HelpTarget {
  /** Page path below the help folder, '/' separated, letter case as imported ("Reference/68ks8e.htm"). */
  page: string;
  /** The part after '#', without it; '' when there is none. */
  fragment: string;
}

export interface SitemapNode {
  /** The first `Name` parameter. */
  name: string;
  /** Every `Name` parameter, in order. */
  names: string[];
  /** Where the entry leads; null for an entry that only groups. */
  target: HelpTarget | null;
  children: SitemapNode[];
}

/** The Latin-1 character references of HTML 4 (U+00A0 to U+00FF, in order), the ones the sitemaps use. */
const LATIN1_NAMES =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'.split(
    ' ',
  );

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ...Object.fromEntries(LATIN1_NAMES.map((name, index) => [name, String.fromCharCode(0xa0 + index)])),
};

/** The text of an attribute value: named and numeric character references decoded. */
function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (whole, decimal?: string, hex?: string, name?: string) => {
    if (decimal !== undefined) return String.fromCodePoint(Number(decimal));
    if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
    return (name !== undefined ? ENTITIES[name] : undefined) ?? whole;
  });
}

/** `Directives\conditional.htm#top` as a target: '/' separators, the fragment split off. */
export function parseLocal(local: string): HelpTarget {
  const normal = local.replace(/\\/g, '/');
  const hash = normal.indexOf('#');
  return hash < 0 ? { page: normal, fragment: '' } : { page: normal.slice(0, hash), fragment: normal.slice(hash + 1) };
}

const TOKEN = /<(\/?)UL\b[^>]*>|<OBJECT\b[^>]*\btype\s*=\s*["']?text\/sitemap["']?[^>]*>([\s\S]*?)<\/OBJECT>/gi;
const PARAM = /<param\s+name\s*=\s*"([^"]*)"\s+value\s*=\s*"([^"]*)"\s*>/gi;

/** The entries of a sitemap file, as the tree the file describes. */
export function parseSitemap(text: string): SitemapNode[] {
  const root: SitemapNode[] = [];
  const lists: SitemapNode[][] = [];
  let current: SitemapNode[] = root;
  let last: SitemapNode | null = null;
  let depth = 0;
  for (const token of text.matchAll(TOKEN)) {
    const [, closing, body] = token;
    if (body === undefined) {
      // <UL> or </UL>
      if (closing === '/') {
        depth--;
        if (depth > 0) current = lists.pop() ?? root;
      } else {
        depth++;
        // The outermost list is the root; a deeper one belongs to the entry before it.
        if (depth > 1 && last) {
          lists.push(current);
          current = last.children;
        }
      }
      continue;
    }
    const names: string[] = [];
    let local: string | null = null;
    for (const param of body.matchAll(PARAM)) {
      const [, key = '', value = ''] = param;
      if (key.toLowerCase() === 'name') names.push(decodeEntities(value));
      else if (key.toLowerCase() === 'local' && local === null) local = decodeEntities(value);
    }
    last = { name: names[0] ?? '', names, target: local === null ? null : parseLocal(local), children: [] };
    current.push(last);
  }
  return root;
}

/** The entries of a tree in document order, with their depth. */
export function flattenSitemap(nodes: readonly SitemapNode[], depth = 0): { node: SitemapNode; depth: number }[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flattenSitemap(node.children, depth + 1)]);
}
