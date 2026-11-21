* @item sim-core 3.16 addressing modes, MOVEM, MOVEP, PEA, SWAP, EXG
* @recipe log:3
* Moved from tests/oracle/wine/sim/tests/l3_memory.X68 (the proof of official-oracle.md 5.2).
    ORG     $1000
START:

    LEA     AREA,A0
    MOVE.L  #$11223344,(A0)+
    MOVE.W  #$5566,(A0)+
    MOVE.B  #$77,(A0)+
    MOVE.B  #$88,(A0)
    LEA     AREA+16,A2
    MOVEQ   #3,D0
FILL:
    MOVE.B  D0,-(A2)
    DBRA    D0,FILL
    LEA     AREA,A3
    MOVE.W  2(A3),D1
    MOVEQ   #4,D2
    MOVE.L  0(A3,D2.W),D3
    MOVEM.L D1-D3,AREA+20
    MOVE.L  #$AABBCCDD,D4
    LEA     AREA+40,A4
    MOVEP.L D4,0(A4)
    PEA     $DEAD
    MOVE.L  (SP)+,D5
    SWAP    D5
    EXG     D5,A5

    LEA     AREA,A0
    MOVE.L  #64,D0

    SIMHALT

    DS.W    0
AREA     DS.B   64
    END     START
