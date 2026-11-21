* @item trap15-a 13 Files: task 53 with A1 = $FFFFF0 and D2 = $20 gives
* @item D0.W = 2 and reads nothing; task 53 with A1 = $2000 and D2 = $FFFFFFFF
* @item on a 10-byte file (32-bit wrap of the bounds test, trap15-a 12 item 14)
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
    MOVE.L  D6,D1
    MOVEQ   #0,D2
    MOVEQ   #55,D0
    TRAP    #15
    MOVE.L  D6,D1
    MOVEA.L #$FFFFF0,A1
    MOVEQ   #$20,D2
    MOVEQ   #53,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVEA.L #$FFFFF0,A0
    MOVEQ   #16,D0
    JSR     DMP_MEM
    MOVE.L  D6,D1
    MOVEA.L #$2000,A1
    MOVEQ   #-1,D2
    MOVEQ   #53,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVEA.L #$2000,A0
    MOVEQ   #12,D0
    JSR     DMP_MEM
    JSR     DMP_CLOSE
    SIMHALT
NAME DC.B   'bounds.bin',0
DATA DC.B   'abcdefghij'
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START