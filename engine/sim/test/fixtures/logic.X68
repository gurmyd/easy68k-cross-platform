*-----------------------------------------------------------
* Title      : logic - logical, shift, rotate and bit instructions
* Written by : easy68k-mac project (test fixture, GPL-2.0-or-later)
* Description: Each case records SR (word) and a long result at (A6)+.
*              test/instructions.test.mjs asserts the records.
*-----------------------------------------------------------
REC     MACRO                   record SR, then the long \1
        MOVE    SR,(A6)+
        MOVE.L  \1,(A6)+
        ENDM

        ORG     $1000
START:  LEA     RESULTS,A6
        LEA     MEM,A0

* ---- AND / OR / EOR / NOT ----------------------------------
        MOVE.L  #$F0F0F0F0,D0
        MOVE.L  #$FF00FF00,D1
        MOVE    #$1F,CCR
        AND.L   D1,D0                   1  N; V C cleared; X kept
        REC     D0
        MOVE.L  #$0000F0F0,D0
        OR.W    #$0F0F,D0               2  N (word)
        REC     D0
        MOVE.L  #$12345678,D0
        EOR.L   D0,D0                   3  Z
        REC     D0
        MOVE.L  #$00FF00FF,D0
        NOT.L   D0                      4  N
        REC     D0
        MOVE.L  #$0F0F0F0F,(A0)
        MOVE.L  #$00FF00FF,D0
        AND.L   D0,(A0)                 5  to memory
        REC     (A0)
        ORI.B   #$80,(A0)               6  N (byte)
        REC     (A0)
        EORI.W  #$FFFF,2(A0)            7
        REC     (A0)
        ANDI.L  #$0000FFFF,D0           8
        REC     D0
* ---- to CCR -----------------------------------------------------
        MOVE    #$00,CCR
        ORI     #$15,CCR                9  X Z C
        REC     D0
        ANDI    #$11,CCR                10 X (the REC above cleared Z and C)
        REC     D0
        EORI    #$1F,CCR                11 N Z V C
        REC     D0
* ---- shifts, register, immediate count ---------------------------
        MOVE    #$00,CCR
        MOVE.L  #$C0000001,D0
        ASL.L   #1,D0                   12 C X from bit 31; sign unchanged, so no V
        REC     D0
        MOVE.L  #$40000000,D0
        ASL.L   #1,D0                   13 sign changes: N V
        REC     D0
        MOVE.L  #$80000003,D0
        ASR.L   #1,D0                   14 sign kept: N C X
        REC     D0
        MOVE.L  #$80000003,D0
        LSR.L   #1,D0                   15 C X
        REC     D0
        MOVE.L  #$000000FF,D0
        LSL.B   #4,D0                   16 byte: N C X
        REC     D0
        MOVE.L  #$00008001,D0
        LSR.W   #8,D0                   17 immediate 0 means 8
        REC     D0
* ---- shifts, count in a register --------------------------------------
        MOVEQ   #33,D1
        MOVE.L  #$FFFFFFFF,D0
        LSL.L   D1,D0                   18 count 33: result 0, C X clear
        REC     D0
        MOVEQ   #0,D1
        MOVE    #$10,CCR
        MOVE.L  #$80000000,D0
        LSR.L   D1,D0                   19 count 0: C cleared, X kept, N from value
        REC     D0
        MOVEQ   #16,D1
        MOVE.L  #$00018000,D0
        ASR.W   D1,D0                   20 word, count 16: all sign bits
        REC     D0
* ---- rotates ----------------------------------------------------------------
        MOVE    #$10,CCR
        MOVE.L  #$80000001,D0
        ROL.L   #1,D0                   21 C from bit rotated; X untouched
        REC     D0
        MOVE.L  #$00000001,D0
        ROR.W   #1,D0                   22 N C
        REC     D0
        MOVE    #$10,CCR
        MOVE.L  #$00000000,D0
        ROXL.L  #1,D0                   23 X shifted in; C X clear afterwards
        REC     D0
        MOVE    #$00,CCR
        MOVE.L  #$00000001,D0
        ROXR.B  #1,D0                   24 Z C X
        REC     D0
        MOVE    #$10,CCR
        MOVEQ   #9,D1
        MOVE.L  #$000000A5,D0
        ROXL.B  D1,D0                   25 count 9 = full circle for a byte
        REC     D0
* ---- memory shifts (word, one bit) ----------------------------------------------
        MOVE.W  #$8001,(A0)
        ASL     (A0)                    26 C X V
        REC     (A0)
        MOVE.W  #$0001,(A0)
        ROR     (A0)                    27 N C
        REC     (A0)
* ---- bit operations ------------------------------------------------------------------
        MOVE.L  #$00000100,D0
        MOVE    #$1F,CCR
        BTST    #8,D0                   28 bit set: Z cleared, other flags kept
        REC     D0
        MOVEQ   #40,D1
        BTST    D1,D0                   29 register operand: bit number modulo 32 (40 -> 8)
        REC     D0
        BCHG    #0,D0                   30 was 0: Z set, bit becomes 1
        REC     D0
        BCLR    #8,D0                   31 was 1: Z clear
        REC     D0
        BSET    #31,D0                  32 was 0: Z set
        REC     D0
        MOVE.B  #$0F,(A0)
        BTST    #7,(A0)                 33 memory operand: byte; bit 7 clear -> Z
        REC     (A0)
        BSET    #15,(A0)                34 memory: bit number modulo 8 (15 -> 7)
        REC     (A0)
        BCLR    #0,(A0)                 35
        REC     (A0)
* ---- TAS, Scc ----------------------------------------------------------------------------
        MOVE.B  #$00,(A0)
        TAS     (A0)                    36 Z from old value; bit 7 set
        REC     (A0)
        TAS     (A0)                    37 N from old value
        REC     (A0)
        MOVE.L  #$FFFFFF00,D0
        MOVE    #$04,CCR
        SEQ     D0                      38 true: $FF
        REC     D0
        MOVE    #$04,CCR
        SNE     D0                      39 false: $00
        REC     D0
        ST      (A0)                    40
        SF      1(A0)
        REC     (A0)
        SIMHALT

        ORG     $3000
MEM     DS.B    64

        ORG     $4000
RESULTS DS.B    6*64

        END     START
