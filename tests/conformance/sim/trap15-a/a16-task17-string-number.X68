* @item trap15-a 13 Text output: task 17 with 'N=',0 and D1 = -5 prints N=-5;
* @item an empty string; a long number
* @recipe report outlog
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     NEQ,A1
    MOVEQ   #-5,D1
    MOVEQ   #17,D0
    TRAP    #15
    LEA     EMPTY,A1
    MOVE.L  #2147483647,D1
    MOVEQ   #17,D0
    TRAP    #15
    JSR     DMP_POS
    JSR     DMP_REGS
    MOVEQ   #0,D1
    MOVE.W  #20,D2
    JSR     DMP_ROW
    JSR     DMP_CLOSE
    SIMHALT
NEQ   DC.B  'N=',0
EMPTY DC.B  0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START