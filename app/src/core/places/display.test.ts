// placeText and placeShort give every text of ARCHITECTURE-PLUS P3.2.5 and P4.5 (N0 acceptance:
// "a table test").

import { describe, expect, it } from 'vitest';
import { placeShort, placeText, type PlaceLabels } from './display';

const LABELS: PlaceLabels[] = [
  { mount: 'browser', label: 'My Programs', kind: 'browser' },
  { mount: 'folder', label: 'Lab', kind: 'fsaccess' },
  { mount: 'linked', label: 'Linked files', kind: 'fsaccess' },
  { mount: 'disk', label: 'This Mac', kind: 'disk' },
  { mount: 'memory', label: 'Memory', kind: 'memory' },
];

/** [path, platform kind, placeText, placeShort] */
const TABLE: [string, 'web' | 'desktop', string, string][] = [
  // P3.2.5: the texts the specification gives word for word
  ['/browser/demo/prog.X68', 'web', 'My Programs/demo/prog.X68', 'My Programs/demo/prog.X68'],
  ['/linked/3/lab1.X68', 'web', 'lab1.X68 - on this computer, edited in place', 'lab1.X68 (on this computer)'],
  ['/folder/prog.X68', 'web', 'Lab/prog.X68 - in the folder "Lab" on this computer', 'Lab/prog.X68'],
  // the desktop app: the real path (P3.2.5 "in the desktop app the real path")
  ['/disk/Users/me/Lab/prog.X68', 'desktop', '/Users/me/Lab/prog.X68', '/Users/me/Lab/prog.X68'],
  ['/disk/C:/Users/me/prog.X68', 'desktop', 'C:\\Users\\me\\prog.X68', 'C:\\Users\\me\\prog.X68'],
  ['/disk/C:', 'desktop', 'C:\\', 'C:\\'],
  ['/disk', 'desktop', '/', '/'],
  // My Programs in the desktop app reads as in a browser
  ['/browser/demo/prog.X68', 'desktop', 'My Programs/demo/prog.X68', 'My Programs/demo/prog.X68'],
  // deeper paths and roots
  ['/folder/sub/dir/a.X68', 'web', 'Lab/sub/dir/a.X68 - in the folder "Lab" on this computer', 'Lab/sub/dir/a.X68'],
  ['/folder', 'web', 'Lab - on this computer', 'Lab'],
  ['/browser', 'web', 'My Programs', 'My Programs'],
  ['/memory/Examples/a.X68', 'web', 'Memory/Examples/a.X68', 'Memory/Examples/a.X68'],
  // the internal folders of linked files are never shown
  ['/linked/3', 'web', 'Linked files', 'Linked files'],
  ['/linked', 'web', 'Linked files', 'Linked files'],
  // an unknown mount, or not a path at all: as given
  ['/elsewhere/x.X68', 'web', '/elsewhere/x.X68', '/elsewhere/x.X68'],
  ['untitled1.x68', 'web', 'untitled1.x68', 'untitled1.x68'],
];

describe('placeText and placeShort (P3.2.5, P4.5)', () => {
  it.each(TABLE)('%s (%s)', (path, kind, text, short) => {
    expect(placeText(LABELS, path, kind)).toBe(text);
    expect(placeShort(LABELS, path)).toBe(short);
  });

  it('never shows the internal path of a linked file', () => {
    for (const kind of ['web', 'desktop'] as const) {
      expect(placeText(LABELS, '/linked/17/report.pdf', kind)).not.toContain('/linked');
      expect(placeShort(LABELS, '/linked/17/report.pdf')).not.toContain('/linked');
    }
  });

  it('names a linked file even when the linked store is not mounted', () => {
    expect(placeText([], '/linked/1/lab1.X68', 'web')).toBe('lab1.X68 - on this computer, edited in place');
    expect(placeShort([], '/linked/1/lab1.X68')).toBe('lab1.X68 (on this computer)');
  });

  it('never shows the internal folders of linked files when the linked store is not mounted', () => {
    for (const path of ['/linked', '/linked/3'] as const) {
      expect(placeText([], path, 'web')).toBe('Linked files');
      expect(placeText([], path, 'desktop')).toBe('Linked files');
      expect(placeShort([], path)).toBe('Linked files');
    }
  });

  it("follows the opened folder's own label", () => {
    const labels: PlaceLabels[] = [{ mount: 'folder', label: 'coursework', kind: 'fsaccess' }];
    expect(placeText(labels, '/folder/a/b.X68', 'web')).toBe(
      'coursework/a/b.X68 - in the folder "coursework" on this computer',
    );
  });
});
