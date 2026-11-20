*-----------------------------------------------------------
* Title      : moves - data movement instructions and every addressing mode
* Written by : easy68k-mac project (test fixture, GPL-2.0-or-later)
* Description: Each case executes one instruction and records the status
*              register and one long result at (A6)+ (6 bytes per record).
*              test/instructions.test.mjs asserts the records.
*-----------------------------------------------------------
REC     MACRO                   record SR, then the long \1
        MOVE    SR,(A6)+
        MOVE.L  \1,(A6)+
        ENDM

        ORG     $1000
START:  LEA     RESULTS,A6
        LEA     DATA,A0

* ---- MOVE.L, the twelve source modes ---------------------
        MOVE.L  #$11223344,D0
        MOVE.L  D0,D7                   1  Dn
        REC     D7
        MOVEA.L #$00FFFF80,A1
        MOVE.L  A1,D7                   2  An
        REC     D7
        MOVE.L  (A0),D7                 3  (An)
        REC     D7
        MOVE.L  (A0)+,D7                4  (An)+
        REC     D7
        REC     A0                      5  A0 advanced by 4
        MOVE.L  -(A0),D7                6  -(An)
        REC     D7
        MOVE.L  4(A0),D7                7  d16(An)
        REC     D7
        MOVEQ   #8,D1
        MOVE.L  0(A0,D1.L),D7           8  d8(An,Dn.L)
        REC     D7
        MOVE.L  #$FFFF000C,D1
        MOVE.L  0(A0,D1.W),D7           9  d8(An,Dn.W): index sign-extended from word
        REC     D7
        MOVE.L  $2000.W,D7              10 abs.W
        REC     D7
        MOVE.L  DATA+4,D7               11 abs.L
        REC     D7
        BRA.S   PCSKIP
PCDATA  DC.L    $CAFEBABE,$0BADF00D
PCSKIP  MOVE.L  PCDATA(PC),D7           12 d16(PC)
        REC     D7
        MOVEQ   #4,D1
        MOVE.L  PCDATA(PC,D1.W),D7      13 d8(PC,Xn)
        REC     D7
        MOVE.L  #$80000000,D7           14 #imm (N set)
        REC     D7
        MOVE.L  #0,D7                   15 zero (Z set)
        REC     D7

* ---- MOVE, the destination modes -------------------------
        LEA     SCRATCH,A2
        MOVE.L  #$A1B2C3D4,D0
        MOVE.L  D0,(A2)                 16 (An)
        REC     (A2)
        MOVE.W  D0,(A2)+                17 (An)+ word
        REC     A2
        MOVE.B  D0,-(A2)                18 -(An) byte: A2 = SCRATCH+1
        REC     A2
        REC     SCRATCH                 19 memory now C3 D4 C3 D4
        LEA     SCRATCH,A2
        MOVE.L  D0,8(A2)                20 d16(An) -> SCRATCH+8 .. +11
        REC     SCRATCH+8
        MOVEQ   #2,D1
        MOVE.W  D0,8(A2,D1.L)           21 d8(An,Xn) -> SCRATCH+10
        REC     SCRATCH+8
        MOVE.W  #$5566,SCRATCH+16.W     22 abs.W
        MOVE.W  #$7788,SCRATCH+18       23 abs.L
        REC     SCRATCH+16

* ---- sizes: byte and word moves keep the upper register bits
        MOVE.L  #$FFFFFFFF,D7
        MOVE.B  #$12,D7                 24
        REC     D7
        MOVE.W  #$8001,D7               25 N from bit 15
        REC     D7

* ---- MOVEA, MOVEQ, EXG, SWAP, EXT, CLR --------------------
        MOVEA.W #$8000,A3               26 MOVEA.W sign-extends, flags unchanged
        REC     A3
        MOVEA.L #$12345678,A3           27
        REC     A3
        MOVEQ   #-1,D7                  28
        REC     D7
        MOVEQ   #127,D7                 29
        REC     D7
        MOVE.L  #$11111111,D2
        MOVE.L  #$22222222,D3
        EXG     D2,D3                   30
        REC     D2
        MOVEA.L #$33333333,A3
        MOVEA.L #$44444444,A4
        EXG     A3,A4                   31
        REC     A3
        EXG     D2,A4                   32
        REC     D2
        REC     A4                      33
        MOVE.L  #$1234ABCD,D7
        SWAP    D7                      34
        REC     D7
        MOVE.L  #$123400FF,D7
        EXT.W   D7                      35 byte -> word
        REC     D7
        MOVE.L  #$12348000,D7
        EXT.L   D7                      36 word -> long
        REC     D7
        MOVE.L  #$FFFFFFFF,D7
        CLR.B   D7                      37
        REC     D7
        CLR.W   D7                      38
        REC     D7
        CLR.L   D7                      39
        REC     D7

* ---- LEA, PEA, LINK, UNLK ---------------------------------
        LEA     SCRATCH,A3
        LEA     4(A3),A4                40
        REC     A4
        MOVEQ   #6,D1
        LEA     2(A3,D1.W),A4           41
        REC     A4
        LEA     PCDATA(PC),A4           42
        REC     A4
        LEA     $7FFF.W,A4              43 abs.W positive
        REC     A4
        MOVEA.L #$8000,A7               (supervisor stack)
        PEA     $1234.W                 44
        REC     (A7)
        REC     A7                      45
        MOVEA.L #$00007000,A5
        LINK    A5,#-8                  46 push A5, A5 = SP, SP -= 8
        REC     A5
        REC     A7                      47
        REC     (A5)                    48 saved A5
        UNLK    A5                      49
        REC     A5
        REC     A7                      50

* ---- MOVEM --------------------------------------------------
        MOVE.L  #$D0D0D0D0,D0
        MOVE.L  #$D1D1D1D1,D1
        MOVEA.L #$A0A0A0A0,A0
        MOVEA.L #$00008000,A7
        MOVEM.L D0-D1/A0,-(A7)          51 pushes A0, D1, D0 (D0 at the lowest address)
        REC     A7
        REC     (A7)                    52 D0
        REC     8(A7)                   53 A0
        MOVEQ   #0,D0
        MOVEQ   #0,D1
        SUBA.L  A0,A0
        MOVEM.L (A7)+,D0-D1/A0          54
        REC     D0
        REC     A0                      55
        REC     A7                      56
        LEA     SCRATCH+32,A3
        MOVE.L  #$1234FFFE,D0
        MOVEM.W D0,(A3)                 57 word to memory
        MOVEM.W (A3),D4                 58 word from memory is sign-extended
        REC     D4

* ---- MOVEP ---------------------------------------------------
        LEA     SCRATCH+48,A3
        MOVE.L  #$01020304,D0
        MOVEP.L D0,0(A3)                59 bytes go to every other address
        REC     (A3)
        REC     4(A3)                   60
        MOVEQ   #0,D4
        MOVEP.W 0(A3),D4                61 reads bytes at +0 and +2
        REC     D4

* ---- MOVE to / from CCR, SR, USP ------------------------------
        MOVE.W  #$001F,D0
        MOVE    D0,CCR                  62 all five flags set
        REC     D0
        MOVE    #$2700,SR               63 interrupt mask 7
        REC     D0
        MOVE    SR,D4                   64
        REC     D4
        MOVEA.L #$00123456,A3
        MOVE    A3,USP                  65
        MOVE    USP,A4
        REC     A4
        MOVE    #$2000,SR
        SIMHALT

        ORG     $2000
DATA    DC.L    $DEADBEEF,$01020304,$05060708,$090A0B0C

        ORG     $3000
SCRATCH DS.B    64

        ORG     $4000
RESULTS DS.B    6*80

        END     START
