* @item sim-core 3.16 / 8: execution log (instruction only) of shifts and
* @item rotates in a loop: ASL, LSR, ROL, ROXR with register counts
* @recipe log:1
    ORG     $1000
START:
    MOVE.L  #$13579BDF,D0
    MOVE.L  #$2468ACE0,D1
    MOVEQ   #0,D2
    MOVE.W  #299,D7
LOOP:
    ADDQ.W  #3,D2
    ROL.L   D2,D0
    LSR.W   #3,D1
    ROXR.B  D2,D1
    ASL.L   #1,D1
    EOR.L   D0,D1
    DBRA    D7,LOOP
    SIMHALT
    END     START