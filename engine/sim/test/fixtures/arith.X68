*-----------------------------------------------------------
* Title      : arith - arithmetic instructions and their condition codes
* Written by : easy68k-mac project (test fixture, GPL-2.0-or-later)
* Description: Each case records SR (word) and a long result at (A6)+.
*              test/instructions.test.mjs asserts the records.
*-----------------------------------------------------------
REC     MACRO                   record SR, then the long \1
        MOVE    SR,(A6)+
        MOVE.L  \1,(A6)+
        ENDM
CLRCC   MACRO                   all condition codes off
        MOVE    #0,CCR
        ENDM

        ORG     $1000
START:  LEA     RESULTS,A6
        LEA     MEM,A0

* ---- ADD ---------------------------------------------------
        MOVE.L  #$7FFFFFFF,D0
        MOVEQ   #1,D1
        ADD.L   D1,D0                   1  overflow: N V
        REC     D0
        MOVE.L  #$FFFFFFFF,D0
        ADD.L   D1,D0                   2  carry out: Z C X
        REC     D0
        MOVE.L  #$000000FF,D0
        ADD.B   D1,D0                   3  byte: Z C X, upper bits kept
        REC     D0
        MOVE.L  #$00007FFF,D0
        ADD.W   D1,D0                   4  word overflow: N V
        REC     D0
        MOVE.L  #$00000010,(A0)
        MOVEQ   #5,D0
        ADD.L   D0,(A0)                 5  Dn + memory -> memory
        REC     (A0)
        ADD.L   (A0),D0                 6  memory + Dn -> Dn
        REC     D0
* ---- ADDA / SUBA: no flags, word source sign-extended ------
        CLRCC
        MOVEA.L #$00010000,A1
        ADDA.W  #$FFFF,A1               7
        REC     A1
        SUBA.L  #$10,A1                 8
        REC     A1
        SUBA.W  #$8000,A1               9  subtracts $FFFF8000
        REC     A1
* ---- ADDI / SUBI / ADDQ / SUBQ -------------------------------
        MOVE.L  #$12345678,D0
        ADDI.L  #$11111111,D0           10
        REC     D0
        SUBI.W  #$789A,D0               11 word: borrow
        REC     D0
        MOVEQ   #0,D0
        ADDQ.B  #8,D0                   12
        REC     D0
        SUBQ.L  #1,D0                   13
        REC     D0
        MOVEQ   #0,D0
        SUBQ.W  #1,D0                   14 N C X
        REC     D0
        CLRCC
        MOVEA.L #$00001000,A1
        ADDQ.W  #4,A1                   15 to An: whole register, no flags
        REC     A1
        SUBQ.W  #8,A1                   16
        REC     A1
* ---- SUB / NEG / NEGX ------------------------------------------
        MOVE.L  #$80000000,D0
        MOVEQ   #1,D1
        SUB.L   D1,D0                   17 overflow: V
        REC     D0
        MOVEQ   #5,D0
        MOVEQ   #5,D1
        SUB.W   D1,D0                   18 Z
        REC     D0
        MOVEQ   #3,D0
        SUB.B   #4,D0                   19 N C X (SUBI or SUBQ, same flags)
        REC     D0
        MOVEQ   #1,D0
        NEG.L   D0                      20 N C X
        REC     D0
        MOVEQ   #0,D0
        NEG.W   D0                      21 Z, no carry
        REC     D0
        MOVE.L  #$00000080,D0
        NEG.B   D0                      22 $80: N V C X
        REC     D0
        MOVE    #$10,CCR                X set
        MOVEQ   #0,D0
        NEGX.L  D0                      23 0 - 0 - X = -1: N C X
        REC     D0
* ---- ADDX / SUBX --------------------------------------------------
        MOVE    #$14,CCR                X and Z set
        MOVEQ   #0,D0
        MOVEQ   #0,D1
        ADDX.L  D1,D0                   24 0 + 0 + X = 1: Z cleared
        REC     D0
        MOVEQ   #0,D0
        MOVE    #$04,CCR                Z set, X clear
        ADDX.L  D1,D0                   25 result 0: Z stays set
        REC     D0
        MOVEQ   #0,D0
        MOVE    #$00,CCR                Z clear
        ADDX.L  D1,D0                   26 result 0: Z stays clear
        REC     D0
        MOVE    #$10,CCR
        MOVEQ   #5,D0
        MOVEQ   #2,D1
        SUBX.W  D1,D0                   27 5 - 2 - 1 = 2
        REC     D0
        LEA     MEM+16,A1               multi-precision add in memory
        LEA     MEM+24,A2
        MOVE.L  #$FFFFFFFF,-4(A1)
        MOVE.L  #$00000001,-4(A2)
        MOVE    #0,CCR
        ADDX.L  -(A1),-(A2)             28 -(Ay),-(Ax): FFFFFFFF + 1 = 0, carry
        REC     (A2)
        REC     A1                      29
* ---- CMP family: only flags -----------------------------------------
        MOVEQ   #5,D0
        MOVEQ   #7,D1
        CMP.L   D1,D0                   30 5 - 7: N C (X untouched)
        REC     D0
        CMP.L   D0,D1                   31 7 - 5: none
        REC     D1
        CMPI.B  #5,D0                   32 Z
        REC     D0
        MOVEA.L #$00008000,A1
        CMPA.W  #$8000,A1               33 source sign-extended: $8000 - $FFFF8000: C
        REC     A1
        LEA     MEM+32,A1
        LEA     MEM+36,A2
        MOVE.L  #$11112222,(A1)
        MOVE.L  #$11112222,(A2)
        CMPM.L  (A1)+,(A2)+             34 Z, both pointers advance
        REC     A1
        REC     A2                      35
        MOVE.L  #$80000000,D0
        TST.L   D0                      36 N
        REC     D0
        TST.W   D0                      37 Z
        REC     D0
* ---- MULU / MULS -----------------------------------------------------
        MOVE.L  #$1234FFFF,D0
        MULU    #$FFFF,D0               38 FFFF * FFFF = FFFE0001: N
        REC     D0
        MOVE.L  #$0000FFFF,D0
        MULS    #$0002,D0               39 -1 * 2 = -2: N
        REC     D0
        MOVEQ   #0,D0
        MULU    #$1234,D0               40 Z
        REC     D0
* ---- DIVU / DIVS -------------------------------------------------------
        MOVE.L  #$00010005,D0
        DIVU    #$0010,D0               41 65541 / 16 = 4096 rem 5
        REC     D0
        MOVE.L  #-7,D0
        DIVS    #2,D0                   42 -7 / 2 = -3 rem -1
        REC     D0
        MOVE.L  #7,D0
        DIVS    #-2,D0                  43 7 / -2 = -3 rem 1
        REC     D0
        MOVE.L  #$00100000,D0
        MOVE    #$0D,CCR                N Z C set beforehand
        DIVU    #1,D0                   44 overflow: V set, register unchanged
        REC     D0
* ---- BCD ------------------------------------------------------------------
        MOVE    #0,CCR
        MOVEQ   #$19,D0
        MOVEQ   #$28,D1
        ABCD    D1,D0                   45 19 + 28 = 47
        REC     D0
        MOVE    #0,CCR
        MOVE.B  #$99,D0
        MOVEQ   #$01,D1
        ABCD    D1,D0                   46 99 + 01 = 00 carry
        REC     D0
        MOVE    #0,CCR
        MOVEQ   #$42,D0
        MOVEQ   #$13,D1
        SBCD    D1,D0                   47 42 - 13 = 29
        REC     D0
        MOVE    #0,CCR
        MOVEQ   #$25,D0
        NBCD    D0                      48 100 - 25 = 75, borrow
        REC     D0
        SIMHALT

        ORG     $3000
MEM     DS.B    64

        ORG     $4000
RESULTS DS.B    6*64

        END     START
