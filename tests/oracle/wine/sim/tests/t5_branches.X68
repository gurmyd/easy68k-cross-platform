*-----------------------------------------------------------
* t5_branches: CMP/Bcc/Scc/DBcc/CHK-free control flow, BTST/BSET/BCLR/BCHG,
* TAS, EXT, and a small subroutine with LINK/UNLK.
*-----------------------------------------------------------
    ORG     $1000
START:
    LEA     DUMPNAME,A1
    JSR     DMP_OPEN

    MOVEQ   #0,D0               ; sum 1..10 with DBRA
    MOVEQ   #9,D1
    MOVEQ   #1,D2
LOOP:
    ADD.L   D2,D0
    ADDQ.L  #1,D2
    DBRA    D1,LOOP
    MOVE.L  #5,D3
    CMP.L   #7,D3
    SLT     D4
    SGT     D5
    SHI     D6
    MOVE.W  #-1,D7
    DBEQ    D7,*+4              ; condition false, D7 decrements
    JSR     DMP_REGS

    MOVEQ   #0,D0
    BSET    #3,D0
    BCHG    #31,D0
    BTST    #3,D0
    SNE     D1
    BCLR    #3,D0
    MOVE.B  #$80,D2
    EXT.W   D2
    EXT.L   D2
    LEA     BYTE,A0
    TAS     (A0)
    MOVE.B  (A0),D3
    MOVE.L  #3,-(SP)
    BSR     SQUARE
    ADDQ.L  #4,SP
    MOVE.L  D0,D4
    JSR     DMP_REGS

    JSR     DMP_CLOSE
    SIMHALT

SQUARE:                         ; D0 = arg*arg (arg on stack)
    LINK    A6,#-4
    MOVE.L  8(A6),D0
    MULU    D0,D0
    MOVE.L  D0,-4(A6)
    UNLK    A6
    RTS

DUMPNAME DC.B   't5_branches_dump.txt',0
BYTE     DC.B   $05
    DS.W    0
    INCLUDE 'dumplib.X68'
    END     START
