* @item sim-core 8: a long execution log (instruction only): nested DBRA loops,
* @item about 24,000 instructions
* @recipe log:1
* @timeout 2400
    ORG     $1000
START:
    MOVEQ   #0,D0
    MOVE.W  #59,D6
OUTER:
    MOVE.W  #99,D7
INNER:
    ADD.L   D7,D0
    ROR.L   #1,D0
    DBRA    D7,INNER
    ADDQ.L  #1,D1
    DBRA    D6,OUTER
    SIMHALT
    END     START