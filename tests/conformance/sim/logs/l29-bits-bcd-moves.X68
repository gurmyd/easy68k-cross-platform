* @item sim-core 3.16 / 8: a long execution log with registers (about 20,000
* @item instructions): bit operations (BTST, BSET, BCLR, BCHG, dynamic and
* @item static, on Dn and memory), BCD (ABCD, SBCD, NBCD on Dn and -(An)), Scc
* @item with all sixteen conditions, TAS, MOVEP, EXG, LINK and UNLK, PEA, LEA,
* @item MOVEM to and from the stack, MOVE to CCR, MOVE from SR, MOVEA
* @recipe log:2
* @timeout 4800
    ORG     $1000
START:
    MOVE.L  #$A5F0C3E1,D7       ; generator state
    LEA     BUF,A0
    MOVE.W  #239,D6             ; 240 rounds
LOOP:
* xorshift32
    MOVE.L  D7,D0
    LSL.L   #8,D0
    LSL.L   #5,D0
    EOR.L   D0,D7
    MOVE.L  D7,D0
    CLR.W   D0
    SWAP    D0
    LSR.L   #1,D0
    EOR.L   D0,D7
    MOVE.L  D7,D0
    LSL.L   #5,D0
    EOR.L   D0,D7
* bits
    MOVE.L  D7,D1
    MOVE.W  D7,D2
    LSR.W   #5,D2
    BTST    D2,D1
    BSET    D2,D1
    BCHG    #17,D1
    BCLR    D7,D1
    MOVE.L  D1,(A0)
    BTST    D2,(A0)
    BSET    #7,1(A0)
    BCHG    D2,2(A0)
    BCLR    #0,3(A0)
* BCD
    MOVE.B  D7,D3
    ANDI.B  #$99,D3
    MOVE.B  D1,D4
    ANDI.B  #$77,D4
    ABCD    D3,D4
    SBCD    D4,D3
    NBCD    D3
    LEA     BUF+6,A1
    LEA     BUF+8,A2
    ABCD    -(A1),-(A2)
    SBCD    -(A1),-(A2)
    NBCD    (A0)
* conditions after a comparison
    CMP.W   D1,D7
    SHI     D5
    SLS     D5
    SCC     D5
    SCS     D5
    SNE     D5
    SEQ     D5
    SVC     D5
    SVS     D5
    SPL     D5
    SMI     D5
    SGE     D5
    SLT     D5
    SGT     D5
    SLE     D5
    ST      D5
    SF      D5
    TAS     4(A0)
* moves
    MOVEP.W D7,8(A0)
    MOVEP.L 8(A0),D4
    EXG     D3,A3
    EXG     A3,A4
    LINK    A6,#-8
    PEA     4(A6)
    MOVEM.L D1-D4/A3,-(SP)
    MOVEM.L (SP)+,D0/D2-D5
    MOVE.W  D7,CCR
    MOVE.W  SR,D5
    MOVEA.W D7,A3
    LEA     0(A0,D2.W),A4
    ADDQ.L  #4,SP
    UNLK    A6
    DBRA    D6,LOOP
    SIMHALT
BUF DS.B    16
    END     START
