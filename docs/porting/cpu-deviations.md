# Where the EASy68K CPU core differs from a real 68000

Catalogue of work package T4 (ARCHITECTURE.md 6.1 layer L7, 6.2.4). Part of easy68k-mac, an
unofficial port of EASy68K. GPL-2.0-or-later.

**What this is.** The simulator of this project is the original EASy68K v5.16.1 core, compiled to
WebAssembly. Where that core does something a real Motorola 68000 does not, the port keeps it: the
fidelity rule (ARCHITECTURE.md section 0) is about EASy68K, not about the chip. This catalogue
lists those places, found by running a test suite generated from real hardware behaviour through
the core, so that they are known, documented for users who wonder, and frozen: a change of any
test's outcome fails the baseline check. **Nothing here is a defect to fix.**

**What it is not.** It says nothing about whether the port matches EASy68K (that is layers L2-L6:
the official binaries under Wine, the conformance programs, the native twins). And it does not
cover cycle counts, the prefetch queue or bus transactions, which EASy68K does not model.

## Method

- **Suite:** SingleStepTests/680x0, folder `68000/v1`, commit `e0d5ece9670205cc84a0101081837deb446f86a3`
  (docs/porting/ground-truth.md section 5): 124 files, one per instruction and size, 8,065 tests
  each, 1,000,060 tests in all. Each test is a complete CPU state (registers, SR, PC, the two
  prefetch words, the RAM bytes involved) before and after one instruction of a real 68000. The
  suite has no licence, so it is never committed: `tests/conformance/cpu/fetch-suite.mjs`
  downloads it into `build/singlestep/` and checks every file against the size, git blob SHA-1 and
  SHA-256 recorded in `tests/conformance/cpu/suite.json`.
- **Runner:** `tests/conformance/cpu/singlestep.mjs` turns each file into a script of the native-twin
  script language (tests/oracle/native-twin/README.md). Per test: exceptions enabled (as on the
  chip); a NOP traced first so that the double-fault latch of the previous test cannot carry over
  (sim-core.md 3.4, 3.14); SR, USP, SSP, D0-D7, A0-A6 and PC set as typed into the register boxes;
  the prefetch words written at PC and PC+2 (the suite's PC is the opcode address); the RAM bytes
  written; one **Trace Into**; registers and every RAM byte of the final state dumped. The same
  script runs through the WebAssembly engine and through both native simulator twins, and the
  transcripts are identical for all 124 files (`npm run oracle:twins`).
- **Comparison:** D0-D7, A0-A6, USP, SSP, PC, each SR bit (C, V, Z, N, X, the interrupt mask, S,
  T, and the bits a 68000 does not have), every RAM byte of the final state, and any message other
  than the trace line. A test *deviates* when any of these differs.
- **Classes:** instruction file, the exception the real 68000 takes (when the final PC equals a
  vector the test supplies), and the differing fields, with registers grouped (`Dn`, `An`) and the
  five condition codes grouped (`CCR`) so that a class does not depend on which register or flag a
  random test happened to touch. Classes are grouped into the themes below by fixed rules
  (`THEMES` in `tests/conformance/cpu/catalogue.mjs`).
- **Baseline:** `tests/conformance/cpu/baseline.json` holds, per file, the number of tests, the
  number that deviate, the count per class and a SHA-256 over "test index, class" of every
  deviating test - counts, our class names and hashes only, nothing of the suite's content. It is
  checked by every `npm run oracle:twins` (and by `EASY68K_SINGLESTEP=1 npm run test:conformance`).
  After a deliberate change of the core: `node tests/conformance/cpu/run-catalogue.mjs --write-baseline`,
  then update this document.

## Result

**285,116 of 1,000,060 tests deviate (28.5 %); 715,944 match the real 68000 exactly.** 43 of the
124 instruction files have no deviation at all: ADD.b, AND.b, ANDI to CCR, ANDI to SR, BCHG, BCLR,
BSET, BTST, CLR.b, EOR.b, EXG, EXT.l, EXT.w, LSL.b, LSL.l, LSR.b, LSR.l, MOVE.b, MOVEQ, MOVEP.l,
MOVEP.w, MOVE from USP, MOVE to USP, NEG.b, NEGX.b, NOP, NOT.b, OR.b, RESET, ROL.b, ROL.l, ROR.b,
ROR.l, ROXL.b, ROXL.l, ROXR.b, ROXR.l, SUB.b, SWAP, Scc, TAS, TRAPV and TST.b. (The byte forms are
clean because a byte access can never be at an odd address that faults; almost every deviation of
the word and long forms is the address-error frame of theme 1.)

| # | Theme | Classes | Tests |
|---|---|---:|---:|
| 1 | Address error: stack frame contents and work done before the fault | 108 | 178,087 |
| 2 | Unused SR bits are kept | 8 | 36,685 |
| 3 | Effective addresses are truncated to 24 bits | 5 | 21,233 |
| 4 | ABCD, SBCD, NBCD: V and N flags, and digits that are not BCD | 5 | 16,824 |
| 5 | ORI and EORI to CCR change the system byte of SR | 16 | 11,901 |
| 6 | CHK: the flags the 68000 leaves undefined | 2 | 4,358 |
| 7 | ASL, ASR: V, C and X for large shift counts | 8 | 4,120 |
| 8 | Byte accesses through -(A7) and (A7)+ move A7 by 1 | 16 | 4,047 |
| 9 | DIVS, DIVU: flags on overflow and on division by zero | 3 | 3,149 |
| 10 | MULS: V flag not cleared | 1 | 2,569 |
| 11 | LINK A7 and UNLK A7 use the user stack pointer | 2 | 1,996 |
| 12 | TRAP #15 is the simulator's I/O call | 4 | 147 |
| | **Total** | **178** | **285,116** |

All 178 classes, with their counts, are listed at the end. No class is left without a theme.

## The themes

The examples below are written for this document (they are not tests of the suite).

### 1. Address error: stack frame contents and work done before the fault

A word or long access at an odd address (data, or the target of a jump) raises an address error
on the 68000. EASy68K raises it too, through vector 3, with a 14-byte frame (sim-core.md 3.8), but:

- **The frame's contents differ.** EASy68K writes the information word as `$0015` / `$0005`
  (function code "supervisor data" or "supervisor program", R/W bit) with the upper bits zero;
  the 68000 leaves bits of the instruction register there. The stacked PC is EASy68K's
  `OLD_PC + 2` or the PC at the moment of the fault, which is not the value the 68000 stacks
  (the 68000 stacks an address that depends on how far the instruction got, usually 2 to 10
  bytes past the opcode). 141,175 tests differ in nothing but these frame bytes.
- **The two stop at different points of the instruction.** EASy68K completes the address
  calculation before the access, so an `(An)+` or `-(An)` register can already be updated where
  the 68000 has not touched it (`An` in the class); and the condition codes differ where one of
  the two has set them before the fault and the other has not (for example a `MOVE` whose
  destination write faults: the 68000 has already set N and Z from the data, EASy68K has not).
- **Several faults in one instruction.** `ADDX -(Ay),-(Ax)`, `SUBX` and the long forms keep going
  after a faulting access and push a frame for each fault (SSP lower by a further 14 bytes per
  frame).
- **A jump to an odd address faults one step later.** `Bcc`, `BRA`, `BSR`, `DBcc`, `JMP`, `JSR`,
  `RTS`, `RTR` and `RTE` to an odd address set PC to the odd value and return; the address error is
  raised by the opcode fetch of the *next* Trace Into (sim-core.md 3.4 step 3). The 68000 takes the
  exception inside the jump. One step after the instruction, PC, SSP and the stack differ
  (`PC RAM SSP`); the `SR.unused`, `SR.S`, `SR.T` variants are `RTE`/`RTR` loading their SR first.

### 2. Unused SR bits are kept

The 68000's SR has bits 15 (T), 13 (S), 10-8 (interrupt mask) and 4-0 (X N Z V C); writing it
clears the other five bits. EASy68K stores whatever 16-bit value is written (`MOVE to SR`,
`ORI/EORI to SR`, `RTE`, `RTR`), and `MOVE to CCR` / `ORI to CCR` / `EORI to CCR` set bits 5-7 of
the low byte. Example: `MOVE.W #$FFFF,SR` leaves SR = `$FFFF` (68000: `$A71F`). Such bits are
visible to the program through `MOVE from SR` and in the register display. (`ANDI to SR/CCR` can
only clear bits and has no deviation.)

### 3. Effective addresses are truncated to 24 bits

EASy68K computes an effective address as an index into its 16 MB memory, masked to 24 bits, and
`LEA`, `PEA`, `JMP` and `JSR` use that masked value: `LEA (A4),A3` with A4 = `$12345678` gives
A3 = `$00345678` (68000: `$12345678`), `PEA` pushes the masked address, and `JMP`/`JSR` leave a
PC with the upper byte cleared. Memory accesses themselves are unaffected (the 68000 has a 24-bit
address bus too); only the register values differ.

### 4. ABCD, SBCD, NBCD: V and N flags, and digits that are not BCD

Motorola documents N and V as undefined for the BCD instructions; the 68000 sets them by a fixed
rule, EASy68K by another, so N and V differ in many cases (X, Z and C agree whenever the operands
are valid BCD). For operands with a nibble above 9 (not valid BCD) the result byte itself can
differ too: `ABCD D7,D7` with D7.B = `$4F` and X clear gives `$A4` in EASy68K where the 68000
gives `$04` with carry.

### 5. ORI and EORI to CCR change the system byte of SR

`ORI #data,CCR` and `EORI #data,CCR` combine the whole 16-bit immediate word with SR instead of
its low byte. A program in user mode can therefore set the S bit, the T bit or the interrupt mask
when the upper byte of the immediate word is not zero (an assembler normally writes `$00xx` there,
so this concerns code written as data, or self-modifying code). Example: SR = `$2700`, the opcode
`$003C` followed by the word `$8001` gives SR = `$A701` (68000: `$2701`). `ANDI to CCR` is not
affected.

### 6. CHK: the flags the 68000 leaves undefined

Motorola documents Z, V and C as undefined after `CHK`; the 68000 sets them by a fixed rule,
EASy68K by its own, so these flags differ in many cases. Both when the exception is taken (`[CHK]`,
where the difference shows in the SR saved in the frame) and when it is not.

### 7. ASL, ASR: V, C and X for large shift counts

With a register shift count, the count is taken modulo 64. For counts of the operand size or more
EASy68K's C and X for `ASR` and its V for `ASL` differ from the 68000 (for example `ASR.B D5,D3`
with D5 = 12: the 68000 clears C and X, EASy68K sets them to the sign bit). Results in the
register are the same.

### 8. Byte accesses through -(A7) and (A7)+ move A7 by 1

On the 68000 a byte access through `-(A7)` or `(A7)+` moves the stack pointer by 2, so that it
stays even. EASy68K's `ADDX.B`, `SUBX.B`, `ABCD`, `SBCD` (`-(A7)`) and `CMPM.B` (`(A7)+`) move it by
1 (other instructions do keep it even). The byte is then read from or written to a different
address, which is why RAM and flags differ in some of these classes.

### 9. DIVS, DIVU: flags on overflow and on division by zero

On overflow the 68000 clears C and sets V, and N and Z follow fixed rules; EASy68K sets V and
leaves C unchanged. On division by zero the 68000 clears N, Z, V and C before taking the exception;
EASy68K leaves them, so the SR stacked in the frame differs.

### 10. MULS: V flag not cleared

`MULS` should always clear V and C; EASy68K clears C but leaves V as it was. (`MULU` is correct.)

### 11. LINK A7 and UNLK A7 use the user stack pointer

`LINK A7,#d` and `UNLK A7` in supervisor mode read or write the *user* stack pointer (EASy68K's
`A[7]`) where the 68000 uses the active stack pointer (SSP). Other address registers are correct.

### 12. TRAP #15 is the simulator's I/O call

`TRAP #15` with a task number in the low byte of D0 is serviced by the simulator (sim-core.md 6.1)
and does not take the exception; the 68000 takes vector 47. TRAP #0-#14, and TRAP #15 with D0.B
not a task number, are exact. The 147 deviating tests are those whose random D0.B happened to be a
task number (`Dn` when the task returns a result in D0 or D1).

## All classes

Counts from `tests/conformance/cpu/baseline.json`; `node tests/conformance/cpu/run-catalogue.mjs
--from-baseline` prints the same table (with per-file counts) into `build/cpu-catalogue/report.md`.

| Theme | Class | Tests |
|---:|---|---:|
| 1 | RTS [address error]: PC RAM SSP | 4,057 |
| 1 | BSR [address error]: PC RAM SSP | 3,980 |
| 1 | JSR [address error]: RAM | 3,882 |
| 1 | JMP [address error]: RAM | 3,806 |
| 1 | RTR [address error]: PC RAM SR.unused SSP | 3,547 |
| 1 | OR.w [address error]: RAM | 3,415 |
| 1 | MOVEM.w [address error]: RAM | 3,398 |
| 1 | AND.w [address error]: RAM | 3,397 |
| 1 | OR.l [address error]: RAM | 3,335 |
| 1 | AND.l [address error]: RAM | 3,320 |
| 1 | CLR.w [address error]: RAM | 3,169 |
| 1 | CLR.l [address error]: RAM | 3,162 |
| 1 | EOR.l [address error]: RAM | 3,161 |
| 1 | NEG.w [address error]: RAM | 3,154 |
| 1 | NEGX.l [address error]: RAM | 3,146 |
| 1 | NOT.l [address error]: RAM | 3,140 |
| 1 | TST.w [address error]: RAM | 3,137 |
| 1 | EOR.w [address error]: RAM | 3,135 |
| 1 | MOVEtoSR [address error]: RAM | 3,127 |
| 1 | MULS [address error]: RAM | 3,122 |
| 1 | CHK [address error]: RAM | 3,117 |
| 1 | NOT.w [address error]: RAM | 3,108 |
| 1 | MOVEtoCCR [address error]: RAM | 3,107 |
| 1 | TST.l [address error]: RAM | 3,102 |
| 1 | DIVU [address error]: RAM | 3,101 |
| 1 | NEGX.w [address error]: RAM | 3,086 |
| 1 | DIVS [address error]: RAM | 3,073 |
| 1 | MULU [address error]: RAM | 3,073 |
| 1 | MOVEfromSR [address error]: RAM | 3,048 |
| 1 | MOVEM.l [address error]: RAM | 3,043 |
| 1 | NEG.l [address error]: RAM | 3,034 |
| 1 | SUB.l [address error]: RAM | 2,972 |
| 1 | ADD.w [address error]: RAM | 2,948 |
| 1 | SUB.w [address error]: RAM | 2,944 |
| 1 | ADD.l [address error]: RAM | 2,922 |
| 1 | MOVE.l [address error]: RAM | 2,821 |
| 1 | MOVE.w [address error]: RAM | 2,808 |
| 1 | MOVEA.w [address error]: RAM | 2,743 |
| 1 | SUBA.l [address error]: RAM | 2,736 |
| 1 | CMPA.w [address error]: RAM | 2,705 |
| 1 | ADDA.l [address error]: RAM | 2,693 |
| 1 | MOVEA.l [address error]: RAM | 2,686 |
| 1 | SUBA.w [address error]: RAM | 2,679 |
| 1 | ADDA.w [address error]: RAM | 2,634 |
| 1 | CMPA.l [address error]: RAM | 2,615 |
| 1 | CMP.w [address error]: RAM | 2,480 |
| 1 | CMP.l [address error]: RAM | 2,465 |
| 1 | Bcc [address error]: PC RAM SSP | 2,200 |
| 1 | DBcc [address error]: PC RAM SSP | 1,964 |
| 1 | SUBX.l [address error]: An CCR RAM SSP | 1,907 |
| 1 | ADDX.l [address error]: An CCR RAM SSP | 1,901 |
| 1 | MOVE.w [address error]: CCR RAM | 1,546 |
| 1 | MOVE.l [address error]: CCR RAM | 1,244 |
| 1 | SUBX.w [address error]: CCR RAM SSP | 1,128 |
| 1 | RTE [address error]: PC RAM SR.unused SSP | 1,042 |
| 1 | ADDX.w [address error]: CCR RAM SSP | 1,013 |
| 1 | RTE [address error]: PC RAM SR.S SR.unused SSP | 998 |
| 1 | ROL.w [address error]: RAM | 991 |
| 1 | RTE [address error]: PC RAM SR.T SR.unused SSP | 987 |
| 1 | LSR.w [address error]: RAM | 962 |
| 1 | RTE [address error]: PC RAM SR.S SR.T SR.unused SSP | 959 |
| 1 | ASL.w [address error]: RAM | 938 |
| 1 | ROXL.w [address error]: RAM | 937 |
| 1 | ASR.w [address error]: RAM | 923 |
| 1 | LSL.w [address error]: RAM | 904 |
| 1 | ROXR.w [address error]: RAM | 893 |
| 1 | ROR.w [address error]: RAM | 878 |
| 1 | SUBX.w [address error]: An CCR RAM SSP | 858 |
| 1 | ADDX.w [address error]: An CCR RAM SSP | 835 |
| 1 | MOVEM.l [address error]: An RAM | 799 |
| 1 | MOVE.l [address error]: An CCR RAM | 686 |
| 1 | ADDX.w [address error]: An CCR RAM | 668 |
| 1 | ADDX.l [address error]: An CCR RAM | 618 |
| 1 | SUBX.l [address error]: An CCR RAM | 611 |
| 1 | SUBX.w [address error]: An CCR RAM | 595 |
| 1 | RTR [address error]: PC RAM SSP | 480 |
| 1 | MOVEM.w [address error]: An RAM | 386 |
| 1 | MOVE.w [address error]: An CCR RAM | 322 |
| 1 | CMP.l [address error]: CCR RAM | 193 |
| 1 | CMP.w [address error]: An CCR RAM SSP | 174 |
| 1 | CMP.l [address error]: An CCR RAM SSP | 173 |
| 1 | CMP.w [address error]: CCR RAM | 170 |
| 1 | CMP.l [address error]: An CCR RAM | 138 |
| 1 | CMP.w [address error]: An CCR RAM | 138 |
| 1 | ADDX.l [address error]: An RAM SSP | 55 |
| 1 | SUBX.l [address error]: An RAM SSP | 52 |
| 1 | CMP.w [address error]: CCR RAM SSP | 45 |
| 1 | MOVE.l [address error]: An RAM | 44 |
| 1 | ADDX.w [address error]: RAM SSP | 43 |
| 1 | SUBX.w [address error]: RAM SSP | 43 |
| 1 | CMP.l [address error]: CCR RAM SSP | 42 |
| 1 | SUBX.w [address error]: An RAM SSP | 31 |
| 1 | ADDX.w [address error]: An RAM SSP | 25 |
| 1 | SUBX.w [address error]: An RAM | 23 |
| 1 | RTE [address error]: PC RAM SR.S SSP | 22 |
| 1 | MOVE.w [address error]: An RAM | 21 |
| 1 | ADDX.l [address error]: An RAM | 19 |
| 1 | RTE [address error]: PC RAM SR.S SR.T SSP | 19 |
| 1 | CMP.w [address error]: An RAM SSP | 17 |
| 1 | ADDX.w [address error]: An RAM | 16 |
| 1 | RTE [address error]: PC RAM SSP | 14 |
| 1 | SUBX.l [address error]: An RAM | 14 |
| 1 | RTE [address error]: PC RAM SR.T SSP | 13 |
| 1 | CMP.w [address error]: An RAM | 12 |
| 1 | CMP.l [address error]: An RAM SSP | 11 |
| 1 | CMP.l [address error]: RAM SSP | 5 |
| 1 | CMP.w [address error]: RAM SSP | 5 |
| 1 | CMP.l [address error]: An RAM | 4 |
| 2 | ORItoSR: SR.unused | 7,947 |
| 2 | EORItoSR: SR.unused | 7,924 |
| 2 | MOVEtoSR: SR.unused | 4,842 |
| 2 | MOVEtoCCR: SR.unused | 4,344 |
| 2 | RTE: SR.unused | 3,957 |
| 2 | ORItoCCR: SR.unused | 3,923 |
| 2 | RTR: SR.unused | 3,512 |
| 2 | EORItoCCR: SR.unused | 236 |
| 3 | PEA: RAM | 7,022 |
| 3 | LEA: An | 6,116 |
| 3 | JMP: PC | 3,636 |
| 3 | JSR: PC | 3,562 |
| 3 | LEA: SSP | 897 |
| 4 | NBCD: CCR | 6,064 |
| 4 | ABCD: CCR | 5,404 |
| 4 | SBCD: CCR | 5,337 |
| 4 | ABCD: CCR Dn | 12 |
| 4 | ABCD: CCR RAM | 7 |
| 5 | ORItoCCR: SR.T SR.unused | 4,011 |
| 5 | EORItoCCR: SR.IPL SR.S SR.unused | 1,821 |
| 5 | EORItoCCR: SR.IPL SR.T SR.unused | 1,739 |
| 5 | EORItoCCR: SR.IPL SR.S SR.T SR.unused | 1,713 |
| 5 | EORItoCCR: SR.IPL SR.unused | 1,692 |
| 5 | EORItoCCR: SR.S SR.T SR.unused | 260 |
| 5 | EORItoCCR: SR.T SR.unused | 256 |
| 5 | EORItoCCR: SR.S SR.unused | 226 |
| 5 | ORItoCCR: SR.T | 65 |
| 5 | EORItoCCR: SR.IPL | 28 |
| 5 | EORItoCCR: SR.IPL SR.T | 26 |
| 5 | EORItoCCR: SR.IPL SR.S | 23 |
| 5 | EORItoCCR: SR.IPL SR.S SR.T | 21 |
| 5 | EORItoCCR: SR.S | 11 |
| 5 | EORItoCCR: SR.S SR.T | 7 |
| 5 | EORItoCCR: SR.T | 2 |
| 6 | CHK [CHK]: CCR RAM | 3,722 |
| 6 | CHK: CCR | 636 |
| 7 | ASR.b: CCR | 1,642 |
| 7 | ASR.w: CCR | 1,063 |
| 7 | ASR.l: CCR | 1,031 |
| 7 | ASL.l: CCR | 158 |
| 7 | ASL.b: CCR | 124 |
| 7 | ASL.w: CCR | 100 |
| 7 | ASL.b: CCR Dn | 1 |
| 7 | ASL.b: Dn | 1 |
| 8 | SBCD: CCR RAM SSP | 821 |
| 8 | ABCD: CCR RAM SSP | 747 |
| 8 | SUBX.b: CCR RAM SSP | 636 |
| 8 | ADDX.b: CCR RAM SSP | 620 |
| 8 | ADDX.b: RAM SSP | 326 |
| 8 | SUBX.b: RAM SSP | 325 |
| 8 | CMP.b: SSP | 203 |
| 8 | ABCD: RAM SSP | 181 |
| 8 | SBCD: RAM SSP | 156 |
| 8 | CMP.b: CCR SSP | 10 |
| 8 | SBCD: CCR SSP | 8 |
| 8 | ADDX.b: SSP | 4 |
| 8 | ABCD: CCR SSP | 3 |
| 8 | SUBX.b: SSP | 3 |
| 8 | ABCD: SSP | 2 |
| 8 | SUBX.b: CCR SSP | 2 |
| 9 | DIVS: CCR | 1,900 |
| 9 | DIVU: CCR | 1,248 |
| 9 | DIVU [zero divide]: CCR RAM | 1 |
| 10 | MULS: CCR | 2,569 |
| 11 | LINK: RAM USP | 1,005 |
| 11 | UNLINK: SSP USP | 991 |
| 12 | TRAP [TRAP]: PC RAM SSP | 110 |
| 12 | TRAP [TRAP]: Dn PC RAM SSP | 32 |
| 12 | TRAP [TRAP]: Dn PC SSP | 3 |
| 12 | TRAP [TRAP]: PC SSP | 2 |
