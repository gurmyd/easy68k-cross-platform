*-----------------------------------------------------------
* Title      : quirks - behaviour of Sim68K that differs from a real 68000
* Written by : easy68k-mac project (test fixture, GPL-2.0-or-later)
* Description: The test puts a case number in D7 and runs.  Case n is the
*              code at $2000 + n*$40.  Each case leaves its evidence in
*              registers or in RESULTS.  test/quirks.test.mjs explains,
*              with references to the original source, what is expected.
*              Opcodes that the assembler would refuse are written DC.W.
*-----------------------------------------------------------
        ORG     $1000
START:  LEA     RESULTS,A6
        LSL.W   #6,D7
        LEA     $2000,A0
        JMP     0(A0,D7.W)

        ORG     $2000           case 0: LEA gives a 24-bit address; abs.W is sign-extended
        LEA     $12345678,A1
        SUBA.L  A2,A2
        LEA     -1(A2),A3
        LEA     $8000.W,A4
        SIMHALT
        ORG     $2040           case 1: PEA pushes the same 24-bit value
        MOVEA.L #$8000,A7
        PEA     $12345678
        MOVE.L  (A7),D1
        SIMHALT
        ORG     $2080           case 2: LINK A7 in supervisor mode uses the USER stack pointer as frame register
        MOVEA.L #$8000,A7
        MOVEA.L #$00005000,A1
        MOVE    A1,USP
        LINK    A7,#-4
        MOVE.L  A7,D1           supervisor stack pointer afterwards
        MOVE    USP,A2          user stack pointer afterwards
        MOVE.L  $7FFC,D2        what was pushed
        SIMHALT
        ORG     $20C0           case 3: ADDQ.B / SUBQ.B to an address register act on the whole register
        MOVEA.L #$000100FF,A1
        DC.W    $5209           ADDQ.B #1,A1
        MOVEA.L #$00010000,A2
        DC.W    $530A           SUBQ.B #1,A2
        SIMHALT
        ORG     $2100           case 4: byte operations on A7: -(A7) and (A7)+ step 2; ADDX, CMPM, ABCD step 1
        MOVEA.L #$8000,A7
        MOVE.B  #$11,-(A7)
        MOVE.L  A7,(A6)+
        MOVE.B  (A7)+,D0
        MOVE.L  A7,(A6)+
        MOVEA.L #$7000,A1
        MOVE    #0,CCR
        DC.W    $DF09           ADDX.B -(A1),-(A7)
        MOVE.L  A7,(A6)+
        MOVEA.L #$8000,A7
        DC.W    $BF09           CMPM.B (A1)+,(A7)+
        MOVE.L  A7,(A6)+
        MOVEA.L #$8000,A7
        MOVE    #0,CCR
        DC.W    $CF09           ABCD -(A1),-(A7)
        MOVE.L  A7,(A6)+
        MOVEA.L #$8000,A7
        SIMHALT
        ORG     $2180           case 6: MULS leaves V as it was
        MOVEQ   #3,D0
        MOVE    #$02,CCR        V set
        MULS    #5,D0
        MOVE    SR,D1
        SIMHALT
        ORG     $21C0           case 7: a branch displacement byte of $FF is -1 (not the 68020 long form)
        DC.W    $60FF
        SIMHALT
        ORG     $2200           case 8: RTE pops six bytes and loads all sixteen SR bits
        MOVEA.L #$8000,A7
        PEA     C8BACK
        MOVE.W  #$3FFF,-(A7)
        RTE
C8BACK  MOVE    SR,D1
        MOVE.L  A7,D2
        SIMHALT
        ORG     $2240           case 9: ORI to CCR ORs the whole word into SR, without a privilege check
        ANDI    #$DFFF,SR
        DC.W    $003C,$2700     ORI #$2700,CCR (the high byte is not ignored)
        MOVE    SR,D1
        SIMHALT
        ORG     $2280           case 10: MOVE to CCR stores all eight low bits
        MOVE.W  #$00FF,D0
        MOVE    D0,CCR
        MOVE    SR,D1
        SIMHALT
        ORG     $22C0           case 11: ASL: the V flag for large shift counts
        MOVEQ   #40,D1
        MOVE.L  #$00000001,D0
        ASL.W   D1,D0
        MOVE    SR,D2
        MOVE.L  #$00007F80,D0
        ASL.W   D1,D0
        MOVE    SR,D3
        MOVE.L  #$0000FF80,D0
        ASL.W   D1,D0
        MOVE    SR,D4
        SIMHALT
        ORG     $2300           case 12: MOVEM to -(An) with An in the list stores the initial An
        MOVEA.L #$00006000,A1
        MOVEM.L D0/A1,-(A1)
        MOVE.L  $5FFC,D1
        MOVE.L  A1,D2
        SIMHALT
        ORG     $2340           case 13: BCHG on an immediate operand is accepted
        DC.W    $087C,$0000,$0000
        MOVE    SR,D1
        SIMHALT
        ORG     $2380           case 14: MOVEA.W with an illegal source mode adds 4 cycles before failing
        DC.W    $327D
        ORG     $23C0           case 15: MOVEA.L with an illegal source mode adds 0 cycles
        DC.W    $227D
        ORG     $2400           case 16: DIVS overflow leaves N, Z and C unchanged and the register intact
        MOVE.L  #$7FFFFFFF,D0
        MOVE    #$0D,CCR
        DIVS    #1,D0
        MOVE    SR,D1
        SIMHALT
        ORG     $2440           case 17: CHK compares the unsigned low word with the signed bound
        MOVE.L  #$0000FFFF,D0
        CHK     #-1,D0
        SIMHALT
        ORG     $2480           case 18: JMP keeps 24 bits of the target
        DC.W    $4EF9,$1200,$2490
        ORG     $2490
        MOVE.L  #$600D600D,D1
        SIMHALT
        ORG     $24C0           case 19: MOVE reads its memory destination before writing it
        MOVE.W  #$1234,$3000
        NOP
        SIMHALT
        ORG     $2500           case 20: a long access at $FFFFFE runs past the end of memory
        MOVE.L  #$11223344,$00FFFFFE
        MOVE.L  $00FFFFFE,D1
        MOVE.L  $00FFFFFC,D2
        MOVE.B  $00000000,D3
        SIMHALT
        ORG     $2540           case 21: addresses are 24 bits; the top byte is ignored
        MOVE.L  #$AABBCCDD,$3000
        MOVEA.L #$FF003000,A1
        MOVE.L  (A1),D1
        SIMHALT
        ORG     $2580           case 22: SIMHALT advances the PC past both words
        NOP
        SIMHALT
        ORG     $25C0           case 23: unknown opcode of group 7 ($71xx)
        DC.W    $7100
        ORG     $2600           case 24: STOP with the trace bit set returns the trace result
        MOVE.L  #C24T,$24
        MOVEA.L #$8000,A7
        ORI     #$8000,SR
        STOP    #$2000
        NOP
        SIMHALT
C24T    ADDQ.L  #1,D4           trace handler: count the trace exceptions
        MOVE.L  2(A7),(A6)+     and log the stacked PC
        ANDI.W  #$7FFF,(A7)     return with tracing off
        RTE

        ORG     $4000
RESULTS DS.B    64

        END     START
