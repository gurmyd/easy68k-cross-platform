* @item trap15-a 13 Files / ARCHITECTURE.md 3.8.4: task 53 on the stream of a
* @item task 52 right after a task 54, without a seek between them (C leaves it
* @item undefined; the result is the Borland run-time's): D0 and D2 of the read,
* @item of the close, and what a new stream reads from the file afterwards
* @owner SH6
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     NAME,A1
    MOVEQ   #52,D0
    TRAP    #15
    MOVE.L  D1,D6
    LEA     DATA,A1
    MOVEQ   #5,D2
    MOVEQ   #54,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  D6,D1
    LEA     BUF,A1
    MOVEQ   #4,D2
    MOVEQ   #53,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
    JSR     DMP_REGS
    LEA     NAME,A1
    MOVEQ   #51,D0
    TRAP    #15
    MOVE.L  D1,D6
    LEA     BACK,A1
    MOVEQ   #64,D2
    MOVEQ   #53,D0
    TRAP    #15
    JSR     DMP_REGS
    LEA     BACK,A0
    MOVEQ   #8,D0
    JSR     DMP_MEM
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
    LEA     NAME,A1
    MOVEQ   #57,D0
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
NAME DC.B   'rw.bin',0
DATA DC.B   'ABCDE'
    DS.W    0
BUF  DCB.B  4,$EE
BACK DCB.B  64,$EE
    INCLUDE '..\dumplib.X68'
    END     START