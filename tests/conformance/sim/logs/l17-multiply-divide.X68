* @item sim-core 3.16 / 8: execution log (instruction only) of MULU, MULS, DIVU,
* @item DIVS in a loop with changing operands (overflow included)
* @recipe log:1
    ORG     $1000
START:
    MOVE.L  #12345,D0
    MOVEQ   #7,D1
    MOVE.W  #149,D7
LOOP:
    MOVE.L  D0,D2
    MULU    D1,D2
    MOVE.L  D2,D3
    DIVU    #13,D3
    MOVE.L  D0,D4
    NEG.L   D4
    DIVS    D1,D4
    MULS    #-3,D1
    ADDQ.W  #5,D1
    ADD.L   #4097,D0
    DBRA    D7,LOOP
    SIMHALT
    END     START