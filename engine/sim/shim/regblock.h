// easy68k-mac: regblock.h - the 68000 register block as one struct.
//
// var.h says of these variables: "The following variables must remain
// together.  put() and value_of() check the addresses of these variables to
// decide if an operation is being performed on a 68000 register or 68000
// memory."  The test is (UTILS.CPP:583, 615)
//
//     (int)ptr >= (int)&D[0]  &&  (int)ptr < (int)&inst
//
// Borland C++ laid globals out in declaration order, so that worked.  Clang
// and the WebAssembly linker place each global wherever they like.  Making
// the variables members of one struct, in the original order, restores the
// guarantee.  The references below keep every original use (D[2], &PC,
// (long *)&SR, ...) compiling unchanged and cost nothing at run time.
//
// Layout notes:
//   * SR is a 16-bit short followed by two padding bytes, as in the original
//     (Borland -a8 aligned the next long).  MOVE to CCR / MOVE to SR do
//     put((long *)&SR, ...), which reads and rewrites four bytes starting at
//     SR; the padding absorbs the upper two.
//   * inst must stay the last member: it is the end marker of the test above.
#ifndef EASY68K_REGBLOCK_H
#define EASY68K_REGBLOCK_H

#include "def.h"

struct Easy68kRegBlock {
  long D[D_REGS], A[A_REGS]; // A[7] = user stack pointer, A[8] = supervisor stack pointer
  long PC;
  short SR;
  short SR_padding;          // rewritten with its own value by put((long *)&SR, ...)
  long global_temp;          // to hold an immediate data operand
  long OLD_PC;               // previous PC
  long *EA1, *EA2;
  long EV1, EV2;
  long source, dest, result;
  int inst;
};

extern Easy68kRegBlock easy68k_regs;

#define EASY68K_REG(type, name) static type &name __attribute__((unused)) = easy68k_regs.name
static long (&D)[D_REGS] __attribute__((unused)) = easy68k_regs.D;
static long (&A)[A_REGS] __attribute__((unused)) = easy68k_regs.A;
EASY68K_REG(long, PC);
EASY68K_REG(short, SR);
EASY68K_REG(long, global_temp);
EASY68K_REG(long, OLD_PC);
EASY68K_REG(long *, EA1);
EASY68K_REG(long *, EA2);
EASY68K_REG(long, EV1);
EASY68K_REG(long, EV2);
EASY68K_REG(long, source);
EASY68K_REG(long, dest);
EASY68K_REG(long, result);
EASY68K_REG(int, inst);
#undef EASY68K_REG

#endif
