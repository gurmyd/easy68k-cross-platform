* @item trap15-a 5 tasks 30 and 31 / sim-core 3.15: execution log of a loop that
* @item reads the cycle counter
* @recipe log:2
    ORG     $1000
START:
    MOVEQ   #30,D0
    TRAP    #15
    MOVE.W  #49,D7
LOOP:
    MOVEQ   #31,D0
    TRAP    #15
    MOVE.L  D1,D6
    MULU    D7,D5
    DBRA    D7,LOOP
    SIMHALT
    END     START