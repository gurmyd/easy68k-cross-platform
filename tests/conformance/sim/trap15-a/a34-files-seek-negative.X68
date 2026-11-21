* @item trap15-a 13 Files: task 55 with D2 = $FFFFFFFF (offset -1) gives
* @item D0.W = 2; a seek past the end succeeds, a read there finds the end
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     NAME,A1
    MOVEQ   #52,D0
    TRAP    #15
    MOVE.L  D1,D6
    MOVEQ   #-1,D2
    MOVEQ   #55,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  D6,D1
    MOVE.L  #100,D2
    MOVEQ   #55,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  D6,D1
    LEA     BUF,A1
    MOVEQ   #4,D2
    MOVEQ   #53,D0
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
NAME DC.B   'seek.bin',0
    DS.W    0
BUF  DS.B   4
    INCLUDE '..\dumplib.X68'
    END     START