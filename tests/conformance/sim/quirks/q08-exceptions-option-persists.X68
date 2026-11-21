* @item trap15-a 5 task 32 sub-task 5: exceptions become enabled at once (a
* @item divide by zero then goes through vector 5); sim-ui Q14
    ORG     $1000
START:
    MOVE.L  #DIVZ,$14
    JSR     DMP_OPEN
    MOVEQ   #5,D1
    MOVEQ   #32,D0
    TRAP    #15
    MOVE.L  #10,D0
    MOVEQ   #0,D1
    DIVU    D1,D0
    MOVE.L  COUNT,D1
    LEA     CNT,A1
    JSR     DMP_VAL
    JSR     DMP_CLOSE
    SIMHALT
DIVZ:
    ADDQ.L  #1,COUNT
    RTE
COUNT DC.L  0
CNT   DC.B  'divideByZero',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START