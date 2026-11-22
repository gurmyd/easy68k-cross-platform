# Request from DV2 (repair of D1): run desktop-dev when its own tests change (owner: the gate's configuration engineer)

Status: applied in the round that prepares gate I3 (config), as asked: the guard is
`git diff --quiet "$base" HEAD -- desktop app tests/desktop/dev`, and the comments and the step summary
name `tests/desktop/dev/**`. `tests/lint/ci-workflow.test.ts` runs the guard on a scratch repository for a
push that changes only `tests/desktop/dev/programs.spec.ts` (runs), `app/` or `desktop/` (runs), or
`docs/` or `tests/e2e/` (does not run). Recorded in errata W0.md entry 8.

`.github/workflows/ci.yml` starts the job desktop-dev (macos-15) only when `desktop/**` or `app/**`
changed against the push's base (the `guards` step, "desktop-dev: only when desktop/\*\* or app/\*\*
changed"). A push that changes only `tests/desktop/dev/**` (a new or repaired test of the
development suite, such as `programs.spec.ts`, which proves defect D1 stays repaired:
`docs/porting/errata/W1.md` entry 15) therefore never runs those tests on a Mac; the first run
they get is the next push that happens to touch `app/` or `desktop/`, where a broken test then
looks like a broken app.

Asked: add `tests/desktop/dev` to the paths of that `git diff --quiet "$base" HEAD -- desktop app`
(so `-- desktop app tests/desktop/dev`), and the same words to the comment at the top of the file
("desktop/\*\* or app/\*\* changed"). Nothing else changes.
