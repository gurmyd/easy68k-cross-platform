* @item trap15-a 13 Timing and environment: only D0.B selects the task
* @item (D0 = $0000010E behaves as task 14; D0 = $FFFF0006 as task 6); D0 is
* @item not changed by a text task
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     HI,A1
    MOVE.L  #$0000010E,D0
    TRAP    #15
    MOVE.L  D0,D7
    MOVE.L  #$FFFF0006,D0
    MOVEQ   #'!',D1
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_POS
    MOVEQ   #0,D1
    MOVE.W  #4,D2
    JSR     DMP_ROW
    JSR     DMP_CLOSE
    SIMHALT
HI  DC.B    'HI',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START