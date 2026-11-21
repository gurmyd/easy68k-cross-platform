* @item trap15-a 13 Files: task 53 with D2 = 0 on a freshly opened file, and
* @item task 54 with D2 = 0 (trap15-a 12 item 14: the result the official
* @item program gives)
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     NAME,A1
    MOVEQ   #52,D0
    TRAP    #15
    MOVE.L  D1,D6
    LEA     BUF,A1
    MOVEQ   #0,D2
    MOVEQ   #54,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  D6,D1
    LEA     BUF,A1
    MOVEQ   #4,D2
    MOVEQ   #54,D0
    TRAP    #15
    MOVE.L  D6,D1
    MOVEQ   #0,D2
    MOVEQ   #55,D0
    TRAP    #15
    MOVE.L  D6,D1
    LEA     BUF,A1
    MOVEQ   #0,D2
    MOVEQ   #53,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
    LEA     NAME,A1
    MOVEQ   #51,D0
    TRAP    #15
    MOVE.L  D1,D6
    LEA     BUF,A1
    MOVEQ   #0,D2
    MOVEQ   #53,D0
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
NAME DC.B   'zero.bin',0
    DS.W    0
BUF  DC.B   'ABCD'
    INCLUDE '..\dumplib.X68'
    END     START