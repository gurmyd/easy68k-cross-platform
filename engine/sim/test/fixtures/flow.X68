*-----------------------------------------------------------
* Title      : flow - branches, subroutines, DBcc, Scc conditions, CHK, TRAPV
* Written by : easy68k-mac project (test fixture, GPL-2.0-or-later)
* Description: Results are collected in registers and in the table at
*              RESULTS; test/instructions.test.mjs asserts them.
*-----------------------------------------------------------
        ORG     $1000
START:  LEA     RESULTS,A6
        MOVEA.L #$8000,A7

* ---- all sixteen conditions against four CCR patterns ------
* For each CCR value the 16 Scc results are packed into a word,
* bit n = condition n (T F HI LS CC CS NE EQ VC VS PL MI GE LT GT LE).
        LEA     CCRS,A0
        MOVEQ   #3,D7
CCLOOP  MOVE.B  (A0)+,D6        CCR pattern under test
        MOVEQ   #0,D5           result word
        MOVE    D6,CCR
        ST      D0
        BSR     PACK            0  T
        MOVE    D6,CCR
        SF      D0
        BSR     PACK            1  F
        MOVE    D6,CCR
        SHI     D0
        BSR     PACK            2  HI
        MOVE    D6,CCR
        SLS     D0
        BSR     PACK            3  LS
        MOVE    D6,CCR
        SCC     D0
        BSR     PACK            4  CC
        MOVE    D6,CCR
        SCS     D0
        BSR     PACK            5  CS
        MOVE    D6,CCR
        SNE     D0
        BSR     PACK            6  NE
        MOVE    D6,CCR
        SEQ     D0
        BSR     PACK            7  EQ
        MOVE    D6,CCR
        SVC     D0
        BSR     PACK            8  VC
        MOVE    D6,CCR
        SVS     D0
        BSR     PACK            9  VS
        MOVE    D6,CCR
        SPL     D0
        BSR     PACK            10 PL
        MOVE    D6,CCR
        SMI     D0
        BSR     PACK            11 MI
        MOVE    D6,CCR
        SGE     D0
        BSR     PACK            12 GE
        MOVE    D6,CCR
        SLT     D0
        BSR     PACK            13 LT
        MOVE    D6,CCR
        SGT     D0
        BSR     PACK            14 GT
        MOVE    D6,CCR
        SLE     D0
        BSR     PACK            15 LE
        MOVE.W  D5,(A6)+        the 16 bits arrive reversed: T is bit 15, LE bit 0
        DBRA    D7,CCLOOP

* ---- Bcc taken / not taken, byte and word displacement --------
        MOVEQ   #0,D4
        MOVE    #$04,CCR
        BEQ.S   B1              taken (short)
        ADDQ    #1,D4           skipped
B1      BNE.S   B2              not taken
        ADDQ    #2,D4
B2      MOVE    #$04,CCR
        BEQ.W   B3              taken (word)
        ADDQ    #4,D4           skipped
B3      BRA.W   B4
        ADDQ    #8,D4           skipped
B4      MOVE.W  D4,(A6)+        expect 2

* ---- DBcc ----------------------------------------------------------
        MOVEQ   #0,D4
        MOVEQ   #4,D3
DB1     ADDQ    #1,D4
        DBF     D3,DB1          runs 5 times, leaves D3.W = $FFFF
        MOVE.W  D4,(A6)+        expect 5
        MOVE.W  D3,(A6)+        expect $FFFF
        MOVEQ   #9,D3
        MOVE    #$04,CCR
        DBEQ    D3,DB1          condition true: no decrement, no branch
        MOVE.W  D3,(A6)+        expect 9
        MOVE.L  #$00010000,D3
        DBF     D3,DB2          only the low word counts: 0 -> $FFFF, falls through
DB2     MOVE.L  D3,(A6)+        expect $0001FFFF

* ---- JSR / JMP addressing modes, RTS, RTR ---------------------------
        MOVEQ   #0,D4
        JSR     SUB1            abs.L
        LEA     SUB1,A1
        JSR     (A1)            (An)
        JSR     4(A1)           d16(An): enters at SUB1+4
        MOVEQ   #4,D1
        JSR     0(A1,D1.W)      d8(An,Xn): SUB1+4 again
        JSR     SUB1(PC)        d16(PC)
        JSR     SUB1.W          abs.W
        MOVE.W  D4,(A6)+        expect $0100*4 + $0001*6 = $0406
        LEA     J1,A1
        JMP     (A1)
        ADDQ    #1,D4           skipped
J1      JMP     J2(PC)
        ADDQ    #1,D4           skipped
J2      MOVE.W  D4,(A6)+        expect $0406
        MOVE.L  A7,(A6)+        stack balanced: expect $00008000
        MOVE    #$1F,CCR
        BSR     SUBRTR          RTR restores the CCR saved by the subroutine
        MOVE    SR,(A6)+        expect $2015 (X Z C as pushed)
        NOP

* ---- CHK and TRAPV that do not trap ----------------------------------
        MOVEQ   #5,D0
        MOVE    #$00,CCR
        CHK     #10,D0          0 <= 5 <= 10: no exception
        MOVE    SR,(A6)+        expect: N from D0 (0); Z V C inverted by this simulator: $2007
        MOVE    #$00,CCR
        TRAPV                   V clear: nothing
        MOVE.W  #$600D,(A6)+
        SIMHALT

PACK    ANDI.W  #1,D0           D0.B is $FF or $00 -> 1 or 0
        ADD.W   D5,D5
        OR.W    D0,D5
        RTS

SUB1    ADDI.W  #$0100,D4       entered at SUB1: both adds; at SUB1+4: only the second
        ADDQ.W  #1,D4
        RTS

SUBRTR  MOVE.W  #$0015,-(A7)    CCR image for RTR
        RTR

CCRS    DC.B    $00,$04,$0A,$09  none; Z; N V; N C

        ORG     $4000
RESULTS DS.B    64

        END     START
