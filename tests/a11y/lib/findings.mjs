// How the accessibility audit judges what axe-core reports (ARCHITECTURE.md 2.11, 6.6, 6.9 item 8).
// Owner: Q1.
//
// A finding is one rule on one element. Each is put in one of three classes:
//
//   fidelity  colour contrast of text drawn in a colour of the original (the editor's syntax
//             colours of the Color1/Color2 presets and the user's own colours; 2.8 and the
//             fidelity rule of section 0). Recorded with its numbers in docs/differences/Q1.md,
//             never a failure, never a defect.
//   known     a defect already entered in docs/integration/rc.md under the id given here. It is
//             printed with that id and does not fail the check, so that the check fails only on
//             something new. When its owner repairs it, the entry no longer matches anything and
//             the check says so (a note): the entry is then removed here.
//   new       anything else. Serious and critical ones fail the check; moderate and minor ones are
//             printed.
//
// Unit-tested in findings.test.mjs.

/**
 * Text drawn in a syntax colour of the original. The classes are E3's (`e68-syntax__<element>`),
 * the squiggle is E5's marker on a source line, `data-element` marks the colour samples of
 * Editor Options > Colors (E4).
 */
const SYNTAX_TEXT = /class="[^"]*\b(e68-syntax__\w+|e68-squiggle\b[^"]*)"|data-element="/;

/**
 * Defects found by this audit and entered in docs/integration/rc.md. `rule` is the axe rule,
 * `html` matches the element's markup (axe's `node.html`), `where` optionally restricts the
 * entry to scans whose label matches (mode, dialog, theme).
 * @type {{ id: string, rule: string, html: RegExp, where?: RegExp, owner: string, summary: string }[]}
 */
export const KNOWN = [];

/**
 * Checks of the audit (not axe findings) that fail at a defect entered in docs/integration/rc.md,
 * matched by the check's name (lib/report.mjs). Remove an entry when its owner has repaired it.
 *
 * Empty since the close-out of the round before gate I3 (21 November 2026): Q1-1 to Q1-6 were
 * repaired by their owners and their checks pass in Chromium and WebKit, so each of those checks
 * now fails if its defect returns (docs/integration/rc.md).
 * @type {{ id: string, match: RegExp, owner: string }[]}
 */
export const KNOWN_CHECKS = [];

/**
 * The element of the former defect Q1-6 whose `aria-label` a screen reader dropped: the digits of
 * EASyBIN's File Split (repaired by B1 with role=img). It keeps a check of its own, "the File Split
 * digits of EASyBIN have a name that is read", so that a return of Q1-6 is named as such, while any
 * other element with a dropped label fails the general check (review of Q1, wave three: the first
 * pattern matched every dropped label of an EASyBIN scan).
 */
export const KNOWN_DROPPED_LABEL = /\be68-easybin__digits\b/;

/**
 * Splits the result of droppedLabels into the element of the known defect and everything else.
 * @param {string[]} dropped
 * @returns {{ known: string[], other: string[] }}
 */
export function partitionDroppedLabels(dropped) {
  return {
    known: dropped.filter((item) => KNOWN_DROPPED_LABEL.test(item)),
    other: dropped.filter((item) => !KNOWN_DROPPED_LABEL.test(item)),
  };
}

/**
 * The elements whose `aria-label` (or `aria-labelledby`) a screen reader drops because their role
 * (none, or generic) does not take a name. axe reports them only as "needs review" under
 * `aria-prohibited-attr` (incomplete, not a violation), so the audit judges them itself.
 * @param {{ incomplete?: any[] }} result axe's result
 * @returns {string[]} each element as "<target> <html>"
 */
export function droppedLabels(result) {
  const out = [];
  for (const item of result.incomplete ?? []) {
    if (item.id !== 'aria-prohibited-attr') continue;
    for (const node of item.nodes) out.push(`${node.target.map(String).join(' ')} ${node.html}`);
  }
  return out;
}

/**
 * @param {{ rule: string, html: string, label: string }} finding
 * @param {typeof KNOWN} known
 * @returns {{ status: 'fidelity' | 'known' | 'new', ref?: string }}
 */
export function classify(finding, known = KNOWN) {
  if (finding.rule === 'color-contrast' && SYNTAX_TEXT.test(finding.html)) return { status: 'fidelity' };
  const entry = known.find(
    (item) =>
      item.rule === finding.rule && item.html.test(finding.html) && (!item.where || item.where.test(finding.label)),
  );
  return entry ? { status: 'known', ref: entry.id } : { status: 'new' };
}

/** True for the impacts that fail the audit (6.6: no "serious" or "critical" findings). */
export const isBlocking = (impact) => impact === 'serious' || impact === 'critical';

/**
 * Turns axe's result into findings: one per rule and element, with the scan's label.
 * @param {{ violations: any[] }} result
 * @param {string} label
 */
export function findingsOf(result, label) {
  const out = [];
  for (const violation of result.violations) {
    for (const node of violation.nodes) {
      out.push({
        label,
        rule: violation.id,
        impact: node.impact ?? violation.impact ?? 'unknown',
        target: node.target.map(String).join(' '),
        html: node.html,
        summary: (node.failureSummary ?? '').replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return out;
}

/**
 * The known entries that matched none of the findings (repaired, or the scan no longer reaches
 * the element).
 */
export function unusedKnown(findings, known = KNOWN) {
  return known.filter((entry) => !findings.some((finding) => classify(finding, known).ref === entry.id));
}
