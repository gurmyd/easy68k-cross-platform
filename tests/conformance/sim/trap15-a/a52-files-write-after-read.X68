* @item trap15-a 13 Files / ARCHITECTURE.md 3.8.4: task 54 on a stream right
* @item after a task 53, without a seek between them (write 'ABCDE', seek to 1,
* @item read 2, write 'X'; C leaves it undefined; the result is the Borland
* @item run-time's): D0 of each call, and what the file holds after the close
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
    MOVEQ   #1,D2
    MOVEQ   #55,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  D6,D1
    LEA     BUF,A1
    MOVEQ   #2,D2
    MOVEQ   #53,D0
    TRAP    #15
    JSR     DMP_REGS
    LEA     BUF,A0
    MOVEQ   #4,D0
    JSR     DMP_MEM
    MOVE.L  D6,D1
    LEA     XBYTE,A1
    MOVEQ   #1,D2
    MOVEQ   #54,D0
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
NAME  DC.B  'wr.bin',0
DATA  DC.B  'ABCDE'
XBYTE DC.B  'X'
    DS.W    0
BUF   DCB.B 4,$EE
BACK  DCB.B 64,$EE
    INCLUDE '..\dumplib.X68'
    END     START