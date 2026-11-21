* @item trap15-a 12 item 11 / 13 Files: the same file open in two slots at once
* @item (two task 51), each with its own position; task 52 on the file while
* @item both are open, a write through it, and what the first stream reads next
* @owner SH6
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     NAME,A1
    MOVEQ   #52,D0
    TRAP    #15
    LEA     DATA,A1
    MOVEQ   #4,D2
    MOVEQ   #54,D0
    TRAP    #15
    MOVEQ   #56,D0
    TRAP    #15
    LEA     NAME,A1
    MOVEQ   #51,D0
    TRAP    #15
    MOVE.L  D1,D6
    JSR     DMP_REGS
    LEA     NAME,A1
    MOVEQ   #51,D0
    TRAP    #15
    MOVE.L  D1,D7
    JSR     DMP_REGS
    MOVE.L  D6,D1
    LEA     BUF,A1
    MOVEQ   #1,D2
    MOVEQ   #53,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  D7,D1
    LEA     BUF+1,A1
    MOVEQ   #2,D2
    MOVEQ   #53,D0
    TRAP    #15
    JSR     DMP_REGS
    LEA     BUF,A0
    MOVEQ   #4,D0
    JSR     DMP_MEM
    LEA     NAME,A1
    MOVEQ   #52,D0
    TRAP    #15
    MOVE.L  D1,D5
    JSR     DMP_REGS
    CMP.W   #0,D0
    BNE.S   NOTHIRD
    MOVE.L  D5,D1
    LEA     ZED,A1
    MOVEQ   #1,D2
    MOVEQ   #54,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  D5,D1
    MOVEQ   #56,D0
    TRAP    #15
    JSR     DMP_REGS
NOTHIRD:
    MOVE.L  D6,D1
    LEA     BUF2,A1
    MOVEQ   #3,D2
    MOVEQ   #53,D0
    TRAP    #15
    JSR     DMP_REGS
    LEA     BUF2,A0
    MOVEQ   #4,D0
    JSR     DMP_MEM
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
    MOVE.L  D7,D1
    MOVEQ   #56,D0
    TRAP    #15
    JSR     DMP_REGS
    LEA     NAME,A1
    MOVEQ   #57,D0
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
NAME DC.B   'two.bin',0
DATA DC.B   'ABCD'
ZED  DC.B   'Z'
    DS.W    0
BUF  DCB.B  4,$EE
BUF2 DCB.B  4,$EE
    INCLUDE '..\dumplib.X68'
    END     START