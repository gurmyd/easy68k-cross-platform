* @item trap15-a tasks 3, 6, 20 / sim-ui 13: execution log (instruction only)
* @item with the output log while numbers 1..40 are printed
* @recipe log:1+out
    ORG     $1000
START:
    MOVEQ   #1,D5
LOOP:
    MOVE.L  D5,D1
    MOVEQ   #3,D0
    TRAP    #15
    MOVEQ   #' ',D1
    MOVEQ   #6,D0
    TRAP    #15
    MOVE.L  D5,D1
    MULU    D5,D1
    MOVEQ   #6,D2
    MOVEQ   #20,D0
    TRAP    #15
    MOVEQ   #13,D1
    MOVEQ   #6,D0
    TRAP    #15
    MOVEQ   #10,D1
    TRAP    #15
    ADDQ.L  #1,D5
    CMP.L   #41,D5
    BNE     LOOP
    SIMHALT
    END     START