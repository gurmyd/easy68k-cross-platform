# Request T1 to the owner of docs/porting/assembler.md: two notes of T1 with a wrong cause

Status: open (2026-11-22).

## Why

An independent review of 6.9 item 1 found that two "Corrected" notes T1 placed in
`docs/porting/assembler.md` state causes that the evidence contradicts (errata T1 24 and 25).
`docs/differences/T1.md`, `tests/conformance/asm/known-differences.json` and erratum T1 now say
it correctly; the notes in assembler.md still say the old reading, and T1 does not own the file.

## What

1. Under §9.3.9, the note "**Corrected (erratum T1 11).**": replace it with

   > **Corrected (errata T1 11 and 24).** Measured (`checklist/dir-11-*`): with `IFNE FWD` /
   > `S SET 5` / `DC.B S` / `M MACRO` ... `ENDM` / `ENDC` / `FWD EQU 1` the official program
   > assembles `DC.B S` to `05` with no error and lists `FWD`, `M` and `S` in its symbol table: it
   > assembled the block in pass 1, because the unwritten `t` of §9.3.3 (`EVAL.CPP:76`) was not 0.
   > The port starts `t` at 0 (`PATCHES.md` P7), skips the block in pass 1, and in pass 2 reaches
   > the case of this section (P14): `DC.B S` is `Undefined symbol`, `00`. The unpatched native
   > twin reproduces the official listing. Listed in `tests/conformance/asm/known-differences.json`.

2. Under §9.3.4, the note "**Corrected (erratum T1 10).**": replace "a `%` without a valid
   conversion expands normally" with

   > the other body line, `AND.B #%00001111,D0 ; 50% done`, expands unchanged although `% d` is a
   > valid conversion; why Borland's `fprintf` left it so is not known (erratum T1 25). The
   > `fprintf` is the one that writes the body line into the macro store (`MACRO.CPP:106`), so
   > the code differs with *Macros Expanded* off too.

## Evidence

Erratum T1 24 and 25: the official goldens
`tests/conformance/asm/golden/checklist/dir-11-*/default.L68` and `macro-09-*/mex.L68`, and runs of
`build/asm-native/{patched,unpatched}/ez68k-asm.exe` through `engine/asm/test/tools/native-run.mjs`
on 2026-11-22.
