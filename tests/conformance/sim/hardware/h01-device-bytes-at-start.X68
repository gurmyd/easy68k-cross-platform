* @item hardware 13 items 1, 10: the bytes of the devices right after the load
* @item ($E00000-$E00015) with the Hardware window not shown, and the addresses
* @item task 32 reports for them
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     $E00000,A0
    MOVEQ   #24,D0
    JSR     DMP_MEM
    MOVEQ   #1,D1
    MOVEQ   #32,D0
    TRAP    #15
    MOVE.L  D1,D2
    MOVEQ   #2,D1
    TRAP    #15
    MOVE.L  D1,D3
    MOVEQ   #3,D1
    TRAP    #15
    MOVE.L  D1,D4
    MOVEQ   #7,D1
    TRAP    #15
    MOVE.L  D1,D5
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START