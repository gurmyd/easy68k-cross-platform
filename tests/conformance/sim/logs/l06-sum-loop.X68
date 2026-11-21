* @item sim-core 8 execution log (registers and instruction) of a DBRA loop that
* @item sums 1..1500 (about 4,500 instructions)
* @recipe log:2
    ORG     $1000
START:
    MOVEQ   #0,D0
    MOVEQ   #1,D2
    MOVE.W  #1499,D1
LOOP:
    ADD.L   D2,D0
    ADDQ.L  #1,D2
    DBRA    D1,LOOP
    SIMHALT
    END     START