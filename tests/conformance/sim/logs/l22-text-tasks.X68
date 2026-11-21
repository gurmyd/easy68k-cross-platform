* @item trap15-a 4 / sim-ui 13: execution log with the output log while tasks
* @item 11, 13, 14, 15, 17, 20 and 22 run
* @recipe log:2+out
    ORG     $1000
START:
    MOVE.W  #$0503,D1
    MOVEQ   #11,D0
    TRAP    #15
    LEA     MSG,A1
    MOVEQ   #13,D0
    TRAP    #15
    LEA     NEQ,A1
    MOVE.L  #-77,D1
    MOVEQ   #17,D0
    TRAP    #15
    MOVE.L  #$ABCD,D1
    MOVEQ   #16,D2
    MOVEQ   #15,D0
    TRAP    #15
    MOVE.L  #42,D1
    MOVEQ   #-6,D2
    MOVEQ   #20,D0
    TRAP    #15
    MOVE.L  #$00030003,D1
    MOVEQ   #22,D0
    TRAP    #15
    MOVE.W  #$00FF,D1
    MOVEQ   #11,D0
    TRAP    #15
    SIMHALT
MSG DC.B    'Log with output',0
NEQ DC.B    'N=',0
    END     START