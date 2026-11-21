* @item trap15-a 13 Files: task 59 on a writable file 0, on a missing file 2,
* @item D1 unchanged; task 57 on an existing closed file 0, again 2; task 57
* @item on an open file
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     NAME,A1
    MOVEQ   #52,D0
    TRAP    #15
    MOVE.L  D1,D6
    LEA     NAME,A1
    MOVEQ   #57,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
    LEA     NAME,A1
    MOVE.L  #$11111111,D1
    MOVEQ   #59,D0
    TRAP    #15
    JSR     DMP_REGS
    LEA     NAME,A1
    MOVEQ   #57,D0
    TRAP    #15
    JSR     DMP_REGS
    LEA     NAME,A1
    MOVEQ   #57,D0
    TRAP    #15
    JSR     DMP_REGS
    LEA     NAME,A1
    MOVE.L  #$22222222,D1
    MOVEQ   #59,D0
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
NAME DC.B   'gone.bin',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START