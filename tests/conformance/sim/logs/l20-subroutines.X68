* @item sim-core 3.16 / 8: execution log of nested JSR/BSR/RTS through every
* @item control mode, with RTR
* @recipe log:2
    ORG     $1000
START:
    MOVE.W  #39,D7
LOOP:
    BSR     A
    LEA     B,A0
    JSR     (A0)
    JSR     C(PC)
    PEA     BACK
    MOVE.W  #$0004,-(SP)
    RTR
BACK:
    DBRA    D7,LOOP
    SIMHALT
A   ADDQ.L  #1,D0
    BSR     B
    RTS
B   ADDQ.L  #2,D1
    RTS
C   ADDQ.L  #3,D2
    JSR     B
    RTS
    END     START