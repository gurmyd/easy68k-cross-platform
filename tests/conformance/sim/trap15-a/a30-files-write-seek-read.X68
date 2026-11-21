* @item trap15-a 13 Files: write 10 bytes, task 55 to 0, read 20 bytes gives
* @item D0.W = 0 and D2 = 10 (short read); reading again gives D0.W = 1 and D2
* @item unchanged at 20 (EOF only on a zero-byte read)
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     NAME,A1
    MOVEQ   #52,D0
    TRAP    #15
    MOVE.L  D1,D6
    LEA     DATA,A1
    MOVEQ   #10,D2
    MOVEQ   #54,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  D6,D1
    MOVEQ   #0,D2
    MOVEQ   #55,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  D6,D1
    LEA     BUF,A1
    MOVEQ   #20,D2
    MOVEQ   #53,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  D6,D1
    LEA     BUF,A1
    MOVEQ   #20,D2
    MOVEQ   #53,D0
    TRAP    #15
    JSR     DMP_REGS
    LEA     BUF,A0
    MOVEQ   #24,D0
    JSR     DMP_MEM
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
NAME DC.B   'ten.bin',0
DATA DC.B   '0123456789'
    DS.W    0
BUF  DCB.B  24,$EE
    INCLUDE '..\dumplib.X68'
    END     START