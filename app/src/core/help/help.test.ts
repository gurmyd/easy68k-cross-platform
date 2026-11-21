import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CHECK_NETWORK_ERROR,
  CHECK_UPDATE_AVAILABLE,
  CHECK_UP_TO_DATE,
  EDITOR_ABOUT,
  SIMULATOR_ABOUT,
  parseVersion,
  portVersionFromTitle,
  updateAnswer,
} from './about';
import { ENTRY_PAGES, editorHelpPage, helpKeywordAt, simulatorHelpPage } from './context';
import { INTRO_PAGE, KEYWORDS, isKeyword, pageForKeyword } from './keywords';
import { parseSitemap } from './sitemap';
import { ancestorKeys, findPage, nodeAt, titleMatches, titleOfPage, visibleRows } from './tree';
import { classifyLink, helpUrl, targetOfUrl } from './urls';

const doc = (name: string): string | null => {
  const file = new URL(`../../../../docs/porting/${name}`, import.meta.url);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};

describe('the keyword table', () => {
  it('matches the table of editor-ui §15.3 (keywords and pages, ignoring the case of the pages)', () => {
    const spec = doc('editor-ui.md');
    if (spec === null) return; // the document is not part of a source archive
    const section = spec.slice(spec.indexOf('Keyword table (generated'), spec.indexOf('The table is the original'));
    const expected = new Map<string, string>();
    for (const row of section.matchAll(/^\| (.+?) \| IDH_\w+ \(\d+\) \| (.+?) \|$/gm)) {
      for (const keyword of row[1]!.split(', ')) expected.set(keyword.replace(/ \(reachable.*\)$/, ''), row[2]!);
    }
    expect(expected.size).toBe(197);
    expect(KEYWORDS.map(([keyword]) => keyword).sort()).toEqual([...expected.keys()].sort());
    for (const [keyword, , page] of KEYWORDS)
      expect(page.toLowerCase(), keyword).toBe(expected.get(keyword)!.toLowerCase());
  });

  it('compares ignoring letter case and falls back to the introduction', () => {
    expect(pageForKeyword('move')).toBe('Reference/68ks4d.htm');
    expect(pageForKeyword('Bne')).toBe('Reference/68ks9a.htm');
    expect(pageForKeyword('options')).toBe('options.htm');
    expect(pageForKeyword('MOVE USP')).toBe('Reference/68ks10b.htm');
    expect(pageForKeyword('NOLIST')).toBe(pageForKeyword('LIST'));
    expect(pageForKeyword('BHS')).toBe(INTRO_PAGE); // not in the original's table
    expect(pageForKeyword('INTRO')).toBe(INTRO_PAGE);
    expect(pageForKeyword('')).toBe(INTRO_PAGE);
    expect(isKeyword('dbra')).toBe(true);
    expect(isKeyword('mexit')).toBe(false);
  });

  it('has the original table’s typos', () => {
    for (const word of ['SME', 'SSF', 'SST']) expect(isKeyword(word)).toBe(true);
    for (const word of ['SMI', 'SF', 'ST', 'DBF', 'ELSE']) expect(isKeyword(word)).toBe(false);
  });
});

describe('F1 in the editor (editor-ui §15.3)', () => {
  const at = (text: string, caret: number, selected = '') => helpKeywordAt({ text, caret, selected });

  it('uses the trimmed selection', () => {
    expect(at('  MOVE.L D0,D1', 4, '  MOVE.L ')).toBe('MOVE.L');
    expect(editorHelpPage({ text: 'x', caret: 0, selected: ' ORG ' })).toBe('Directives/org.htm');
  });

  it('opens the introduction when the character before the caret is white space', () => {
    expect(at('MOVE D0,D1', 5)).toBe('INTRO');
    expect(editorHelpPage({ text: 'MOVE D0,D1', caret: 5, selected: '' })).toBe(INTRO_PAGE);
    expect(at('MOVE\n', 5)).toBe('INTRO');
  });

  it('does nothing at the very start of the text', () => {
    expect(at('MOVE', 0)).toBeNull();
    expect(editorHelpPage({ text: 'MOVE', caret: 0, selected: '' })).toBeNull();
  });

  it('takes the run of letters and digits around the caret', () => {
    const text = '  MOVE.L  D0,D1\n';
    expect(at(text, 4)).toBe('MOVE'); // inside the word
    expect(at(text, 3)).toBe('MOVE'); // right after the first letter
    expect(at(text, 6)).toBe('MOVE'); // after the last letter, before the point
    expect(at(text, 8)).toBe('L'); // after the L, before the blanks
    expect(editorHelpPage({ text, caret: 4, selected: '' })).toBe('Reference/68ks4d.htm');
  });

  it('keeps the original quirks: the word starts at the character before the caret, the last character of the text is never part of a word', () => {
    expect(at('a,b\n', 2)).toBe('a,b'); // the character before the caret is taken whatever it is
    expect(at('MOVE', 2)).toBe('MOV'); // Text[Length] is excluded
    expect(at('MOVE\n', 2)).toBe('MOVE');
  });
});

describe('the pages of the entry points', () => {
  it('open the page each was meant for, not the introduction (note 10)', () => {
    expect(ENTRY_PAGES.simulator).toBe('SIMHELP/BasicOperation.htm');
    expect(ENTRY_PAGES.simulatorOptions).toBe('SIMHELP/SimOptions.htm');
    expect(ENTRY_PAGES.editorOptions).toBe('options.htm');
    expect(simulatorHelpPage(null)).toBe(ENTRY_PAGES.simulator);
    expect(simulatorHelpPage('listing')).toBe(ENTRY_PAGES.simulator);
    expect(simulatorHelpPage('memory')).toBe('SIMHELP/Memory.htm');
    expect(simulatorHelpPage('stack')).toBe('SIMHELP/Stack.htm');
    expect(simulatorHelpPage('breakpoints')).toBe('SIMHELP/AdvBreakpoints.htm');
    expect(simulatorHelpPage('hardware')).toBe('SIMHELP/Hardware.htm');
  });
});

describe('sitemap parsing', () => {
  const sample = `<UL>
  <LI> <OBJECT type="text/sitemap"><param name="Name" value="Intro &amp; more"><param name="Local" value="MAIN.HTM"></OBJECT>
  <LI> <OBJECT type="text/sitemap"><param name="Name" value="Book"></OBJECT>
  <UL>
    <LI> <OBJECT type="text/sitemap"><param name="Name" value="Leaf"><param name="Name" value="Second"><param name="Local" value="Dir\\a b.htm#part"></OBJECT>
    <LI> <OBJECT type="text/sitemap"><param name="Name" value="Inner book"></OBJECT>
    <UL><LI> <OBJECT type="text/sitemap"><param name="Name" value="Deep"><param name="Local" value="x.htm"></OBJECT></UL>
  </UL>
  <LI> <OBJECT type="text/sitemap"><param name="Name" value="Last"><param name="Local" value="z.htm"></OBJECT>
</UL>`;
  const tree = parseSitemap(sample);

  it('builds the nesting from the lists', () => {
    expect(tree.map((node) => node.name)).toEqual(['Intro & more', 'Book', 'Last']);
    expect(tree[1]!.children.map((node) => node.name)).toEqual(['Leaf', 'Inner book']);
    expect(tree[1]!.children[1]!.children.map((node) => node.name)).toEqual(['Deep']);
    expect(tree[1]!.target).toBeNull();
  });

  it('reads Local values with their backslashes and fragments, and every Name', () => {
    const leaf = tree[1]!.children[0]!;
    expect(leaf.target).toEqual({ page: 'Dir/a b.htm', fragment: 'part' });
    expect(leaf.names).toEqual(['Leaf', 'Second']);
  });

  it('filters titles and shows the way to a match', () => {
    expect(titleMatches('Basic Operation', 'oper basic')).toBe(true);
    expect(titleMatches('Basic Operation', 'xyz')).toBe(false);
    expect(visibleRows(tree, new Set(), '').map((row) => row.node.name)).toEqual(['Intro & more', 'Book', 'Last']);
    expect(visibleRows(tree, new Set(['1']), '').map((row) => `${row.depth}${row.node.name}`)).toEqual([
      '0Intro & more',
      '0Book',
      '1Leaf',
      '1Inner book',
      '0Last',
    ]);
    const filtered = visibleRows(tree, new Set(), 'deep');
    expect(filtered.map((row) => row.node.name)).toEqual(['Book', 'Inner book', 'Deep']);
    expect(filtered.every((row) => !row.isBook || row.expanded)).toBe(true);
    // A book whose own title matches shows everything below it.
    expect(visibleRows(tree, new Set(), 'book').map((row) => row.node.name)).toEqual([
      'Book',
      'Leaf',
      'Inner book',
      'Deep',
    ]);
    expect(visibleRows(tree, new Set(), 'nothing like it')).toEqual([]);
  });

  it('finds the node of a page and the books above it', () => {
    expect(findPage(tree, 'X.HTM')).toBe('1/1/0');
    expect(findPage(tree, 'nope.htm')).toBeNull();
    expect(ancestorKeys('1/1/0')).toEqual(['1', '1/1']);
    expect(nodeAt(tree, '1/1/0')?.name).toBe('Deep');
    expect(titleOfPage(tree, { page: 'z.htm', fragment: '' })).toBe('Last');
  });
});

describe('help addresses', () => {
  it('encodes each segment and keeps the folder separators', () => {
    expect(helpUrl('http://h/app/', 'Quick Reference.htm')).toBe('http://h/app/help/Quick%20Reference.htm');
    expect(helpUrl('./', { page: 'Reference/68ks10.htm', fragment: '*** CHK ***' })).toBe(
      './help/Reference/68ks10.htm#***%20CHK%20***',
    );
  });

  it('reads an address back', () => {
    const base = 'http://h/app/';
    expect(targetOfUrl(base, helpUrl(base, 'Reference/68ks 1.htm#a b'))).toEqual({
      page: 'Reference/68ks 1.htm',
      fragment: 'a b',
    });
    expect(targetOfUrl(base, 'http://h/other/x.htm')).toBeNull();
  });

  it('classifies the links of a page', () => {
    expect(classifyLink('Directives/dc.htm', '../Options.htm')).toEqual({
      kind: 'page',
      target: { page: 'Options.htm', fragment: '' },
    });
    expect(classifyLink('SIMHELP/Stack.htm', 'IMAGES/Stack/Stack.GIF')).toEqual({
      kind: 'file',
      target: { page: 'SIMHELP/IMAGES/Stack/Stack.GIF', fragment: '' },
    });
    expect(classifyLink('credits.htm', 'GNU%20General%20Public%20License.htm#x')).toEqual({
      kind: 'page',
      target: { page: 'GNU General Public License.htm', fragment: 'x' },
    });
    expect(classifyLink('a/b.htm', '..\\c.htm')).toEqual({ kind: 'page', target: { page: 'c.htm', fragment: '' } });
    expect(classifyLink('a.htm', '#top')).toEqual({ kind: 'fragment' });
    expect(classifyLink('a.htm', 'http://www.easy68k.com')).toEqual({
      kind: 'external',
      url: 'http://www.easy68k.com',
    });
    expect(classifyLink('a.htm', 'mailto:x@y.z')).toEqual({ kind: 'external', url: 'mailto:x@y.z' });
    expect(classifyLink('a.htm', 'javascript:alert(1)')).toEqual({ kind: 'other' });
    expect(classifyLink('a.htm', '../../x.htm')).toEqual({ kind: 'other' });
    expect(classifyLink('a.htm', 'EASy68KQuickRef.pdf').kind).toBe('file');
  });
});

describe('the About boxes', () => {
  it('keep the original texts, letter for letter', () => {
    expect(EDITOR_ABOUT.windowTitle).toBe('About EASy68K');
    expect(EDITOR_ABOUT.title).toBe('EASy68K Editor/Assembler v5.16.01');
    expect(SIMULATOR_ABOUT.windowTitle).toBe('About EASy68K Simulator');
    expect(SIMULATOR_ABOUT.title).toBe('EASy68K Simulator v5.16.1');
    const lines = (about: typeof EDITOR_ABOUT) => about.lines.map((line) => line.text);
    expect(lines(EDITOR_ABOUT)).toEqual([
      'The author of this software assumes no liabilty of its functionality and is not responsible for misuse by the user.  Use at your own risk.  This application is distributed under the GNU general public use license.',
      'GUI design: Tim Larson',
      'Original assembler code: Paul McKee',
      'Modifications and New Features: Charles Kelly',
      'www.easy68k.com',
      'Post comments and bug reports to the EASy68K forum.',
    ]);
    expect(lines(SIMULATOR_ABOUT)).toEqual([
      'GUI implemenation: Charles Kelly',
      'Original simulator code: Paul McKee',
      'Simulator code modification: Charles Kelly, Eric Nelson',
      'www.easy68k.com',
      'Use the EASy68K forum to submit bug reports.',
      'EASy68K is distributed under the GNU general public use license. See Help for more information.',
      'The author of this software assumes no liability for its functionality and is not responsible for damages, losses or liabilities as a result of using this software.  Use at your own risk.',
    ]);
  });

  it('are the texts of the specs (the document is the contract)', () => {
    const editorSpec = doc('editor-ui.md');
    const simSpec = doc('sim-ui.md');
    if (editorSpec === null || simSpec === null) return;
    for (const line of EDITOR_ABOUT.lines) expect(editorSpec, line.text).toContain(line.text);
    for (const line of SIMULATOR_ABOUT.lines) expect(simSpec, line.text).toContain(line.text);
    expect(editorSpec).toContain(EDITOR_ABOUT.title);
    expect(simSpec).toContain(SIMULATOR_ABOUT.title);
  });

  it('link to the original’s address', () => {
    for (const about of [EDITOR_ABOUT, SIMULATOR_ABOUT]) {
      const link = about.lines.find((line) => line.kind === 'link');
      expect(link).toEqual({ kind: 'link', text: 'www.easy68k.com', url: 'http://www.easy68k.com' });
    }
  });

  it('answer the update check as the original does', () => {
    expect([CHECK_UP_TO_DATE, CHECK_UPDATE_AVAILABLE, CHECK_NETWORK_ERROR]).toEqual([
      'Up to date',
      'Update available',
      'Network error',
    ]);
    expect(updateAnswer('0.2.0', 'v0.2.0')).toBe('Up to date');
    expect(updateAnswer('0.2.0', 'v0.10.0')).toBe('Update available');
    expect(updateAnswer('1.0.0', 'v0.9.9')).toBe('Up to date');
    expect(updateAnswer('0.2', '0.2.0.1')).toBe('Update available');
    expect(updateAnswer('unknown', 'v1.0.0')).toBeNull();
    expect(parseVersion('v1.2.3-beta')).toEqual([1, 2, 3]);
    expect(parseVersion('nightly')).toBeNull();
  });

  it('read the version from the window title', () => {
    expect(portVersionFromTitle('EASy68K Editor/Assembler v5.16.01 - unofficial port 0.3.1')).toBe('0.3.1');
    expect(portVersionFromTitle('EASy68K')).toBe('unknown');
  });
});
