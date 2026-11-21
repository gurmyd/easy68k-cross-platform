* @item trap15-a 13 Serial (no port available): task 40 with CID 16 gives
* @item D0.W = 1; with CID 0 and a port name that does not exist D0.W = 2; tasks
* @item 41, 42 and 43 on an unopened CID give 3; D0 bits 31..16 kept
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     NAME,A1
    MOVE.L  #$00100028,D0
    TRAP    #15
    JSR     DMP_REGS
    LEA     NAME,A1
    MOVE.L  #$00000028,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  #$00050029,D0
    MOVEQ   #0,D1
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  #$0005002A,D0
    LEA     BUF,A1
    MOVEQ   #4,D1
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  #$0005002B,D0
    LEA     NAME,A1
    MOVEQ   #4,D1
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
NAME DC.B   'COM97',0
    DS.W    0
BUF  DS.B   8
    INCLUDE '..\dumplib.X68'
    END     START