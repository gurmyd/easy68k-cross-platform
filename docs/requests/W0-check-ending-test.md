# Request W0: run the test of the check scripts' guarded ending

Status: done (follow-ups after b27ae56): root script `test:check-ending` (`node --test
tests/browser-checks/ending.test.mjs`), run by the step "Check scripts' ending (W0)" of the job
`check` in ci.yml after "Documents (DOC1)"; `tests/lint/ci-workflow.test.ts` fails when a
`*.test.mjs` of tests/browser-checks is not named by a root script that a step of that job runs.
Opened at gate I3, CI triage of run 45034018006.

From: W0 (the convention of the browser check scripts; errata/W0.md entry 12)
To: the gate's configuration engineer (root package.json, ci.yml)

`tests/browser-checks/ending.mjs` is the guarded ending every browser check script now imports;
its test is `tests/browser-checks/ending.test.mjs`, a `node:test` file (no browser, about 1.5 s).
Nothing runs it yet: `npm test` is the application workspace's Vitest, and `npm run lint` runs only
`tests/lint`.

Asked: run `node --test tests/browser-checks/ending.test.mjs` in CI, for example as a root script
`test:check-ending` called from the job that runs `check:docs`, or added to `npm run lint`. (On
Windows, Node 24's `node --test <folder>` does not find the file; name the file.)
