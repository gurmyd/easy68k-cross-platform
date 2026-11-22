// The tally of a browser check: "N of M checks passed" (the convention of
// app/src/ui/shell/check-shell.mjs). Owner: Q1. Unit-tested in report.test.mjs.
//
// A check that fails because of a defect already entered in docs/integration/rc.md is listed in
// `knownChecks` (lib/findings.mjs KNOWN_CHECKS) by a pattern over its name. It is then printed as
// "known" with the defect's id and does not count as a failure; when it passes, the report notes
// that the defect seems repaired, so that the entry can be removed.

/**
 * @param {{ log?: (text: string) => void, knownChecks?: { id: string, match: RegExp, owner: string }[] }} [options]
 */
export function createReport({ log = console.log, knownChecks = [] } = {}) {
  const results = [];
  const notes = [];
  const known = [];
  const report = {
    results,
    notes,
    known,
    /**
     * One check; `detail` is printed with it, so that a failure can be diagnosed from the log
     * alone. Returns whether it passed.
     */
    check(name, ok, detail = '') {
      const passed = Boolean(ok);
      const entry = knownChecks.find((item) => item.match.test(name));
      if (!passed && entry) {
        results.push({ name, ok: true, detail, known: entry.id });
        known.push({ id: entry.id, name });
        log(`  known ${name} - ${entry.id} (${entry.owner})${detail ? `: ${detail}` : ''}`);
        return false;
      }
      results.push({ name, ok: passed, detail });
      log(`${passed ? '  ok  ' : '  FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
      if (passed && entry) report.note(`"${name}" passes: known defect ${entry.id} (${entry.owner}) seems repaired`);
      return passed;
    },
    /** Something worth reading that is not a failure (listed again at the end). */
    note(text) {
      notes.push(text);
      log(`  note ${text}`);
    },
    get failures() {
      return results.filter((result) => !result.ok).length;
    },
    summary() {
      const passed = results.filter((result) => result.ok).length;
      const failed = results.length - passed;
      const ids = [...new Set(known.map((item) => item.id))];
      return (
        `${passed} of ${results.length} checks passed${failed ? `, ${failed} failed` : ''}` +
        `${ids.length ? ` (${known.length} of them at a known defect of docs/integration/rc.md: ${ids.join(', ')})` : ''}.`
      );
    },
  };
  return report;
}
