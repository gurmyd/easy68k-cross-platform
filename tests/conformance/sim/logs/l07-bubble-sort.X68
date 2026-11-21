* @item sim-core 8 execution log (instruction only) of a bubble sort of 24
* @item words (CMP, Bcc, MOVE with (An)+ and -(An), DBRA)
* @recipe log:1
    ORG     $1000
START:
    MOVEQ   #22,D7              ; passes - 1
PASS:
    LEA     DATA,A0
    MOVE.W  D7,D6
INNER:
    MOVE.W  (A0)+,D0
    CMP.W   (A0),D0
    BLE     NOSWAP
    MOVE.W  (A0),-2(A0)
    MOVE.W  D0,(A0)
NOSWAP:
    DBRA    D6,INNER
    DBRA    D7,PASS
    SIMHALT
DATA DC.W   900,-3,77,12000,5,5,-800,31,64,2,-1,1000,333,42,-32768,32767,7,8,99,0,-50,600,123,4
    END     START