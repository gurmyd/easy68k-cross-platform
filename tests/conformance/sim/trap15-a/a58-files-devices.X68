* @item trap15-a 13 Files: the Windows device name NUL with task 52 (a write of
* @item 3 bytes, the close), task 59, task 51 and a read of 3 bytes: D0.W and D1
* @item of each (the port's ProgramFiles has no devices)
* @owner SH6
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     DEV,A1
    MOVEQ   #0,D1
    MOVEQ   #52,D0
    TRAP    #15
    MOVE.L  D1,D6
    JSR     DMP_REGS
    MOVE.L  D6,D1
    LEA     DATA,A1
    MOVEQ   #3,D2
    MOVEQ   #54,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
    JSR     DMP_REGS
    LEA     DEV,A1
    MOVEQ   #59,D0
    TRAP    #15
    JSR     DMP_REGS
    LEA     DEV,A1
    MOVEQ   #0,D1
    MOVEQ   #51,D0
    TRAP    #15
    MOVE.L  D1,D6
    JSR     DMP_REGS
    MOVE.L  D6,D1
    LEA     BUF,A1
    MOVEQ   #3,D2
    MOVEQ   #53,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
DEV  DC.B   'NUL',0
DATA DC.B   'abc'
    DS.W    0
BUF  DCB.B  4,$EE
    INCLUDE '..\dumplib.X68'
    END     START