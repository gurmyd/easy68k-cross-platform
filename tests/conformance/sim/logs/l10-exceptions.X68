* @item sim-core 3.9 / 8: execution log through exceptions (exceptions enabled):
* @item TRAP #3, divide by zero, CHK, ILLEGAL, line A, each with its handler
* @recipe log:2
* @switches /e
    ORG     $1000
START:
    MOVE.L  #HANDLER,$8C
    MOVE.L  #HANDLER,$14
    MOVE.L  #HANDLER,$18
    MOVE.L  #SKIP2,$10
    MOVE.L  #SKIP2,$28
    TRAP    #3
    MOVEQ   #0,D1
    MOVE.L  #77,D0
    DIVU    D1,D0
    MOVE.W  #9,D2
    CHK     #3,D2
    ILLEGAL
    DC.W    $A000
    MOVEQ   #-1,D7
    SIMHALT
HANDLER:
    ADDQ.L  #1,D6
    RTE
SKIP2:
    ADDQ.L  #1,D5
    ADDQ.L  #2,2(SP)
    RTE
    END     START