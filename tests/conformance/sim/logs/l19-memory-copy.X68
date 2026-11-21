* @item sim-core 3.16 / 8: execution log (type 3) of a 256-byte block copy and
* @item fill with (An)+, -(An) and MOVE.L
* @recipe log:3
    ORG     $1000
START:
    LEA     $3000,A0
    MOVE.W  #63,D7
    MOVE.L  #$01020304,D0
FILL:
    MOVE.L  D0,(A0)+
    ADD.L   #$04040404,D0
    DBRA    D7,FILL
    LEA     $3000,A0
    LEA     $3200,A1
    MOVE.W  #127,D7
COPY:
    MOVE.W  (A0)+,-(A1)
    DBRA    D7,COPY
    SIMHALT
    END     START