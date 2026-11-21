* @item trap15-a 13 Files / ARCHITECTURE.md 3.8.4: write 'ABCDE', seek 20 bytes
* @item past the end, write 'X', then task 53 without a seek: D0 of the read and
* @item of the close (task 56), what a new stream reads, and task 57 afterwards
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
    MOVE.L  D6,D1
    MOVEQ   #25,D2
    MOVEQ   #55,D0
    TRAP    #15
    MOVE.L  D6,D1
    LEA     XBYTE,A1
    MOVEQ   #1,D2
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
    MOVE.L  D1,D7
    JSR     DMP_REGS
    MOVE.L  D7,D1
    LEA     BACK,A1
    MOVEQ   #64,D2
    MOVEQ   #53,D0
    TRAP    #15
    JSR     DMP_REGS
    LEA     BACK,A0
    MOVEQ   #32,D0
    JSR     DMP_MEM
    MOVE.L  D7,D1
    MOVEQ   #56,D0
    TRAP    #15
    LEA     NAME,A1
    MOVEQ   #57,D0
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
NAME  DC.B  'past.bin',0
DATA  DC.B  'ABCDE'
XBYTE DC.B  'X'
    DS.W    0
BUF   DCB.B 4,$EE
BACK  DCB.B 64,$EE
    INCLUDE '..\dumplib.X68'
    END     START