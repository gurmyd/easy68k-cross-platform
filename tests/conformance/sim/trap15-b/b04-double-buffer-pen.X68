* @item trap15-b 15 V5: task 96 lags in double-buffer mode (mode 17; task 86
* @item (5,5); task 84 to (100,100); task 96 still gives (5,5)); mode 16 back
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVEQ   #17,D1
    MOVEQ   #92,D0
    TRAP    #15
    MOVEQ   #5,D1
    MOVEQ   #5,D2
    MOVEQ   #86,D0
    TRAP    #15
    MOVEQ   #5,D1
    MOVEQ   #5,D2
    MOVE.W  #100,D3
    MOVE.W  #100,D4
    MOVEQ   #84,D0
    TRAP    #15
    MOVEQ   #96,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.W  #30,D1
    MOVE.W  #40,D2
    MOVEQ   #85,D0
    TRAP    #15
    MOVEQ   #96,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVEQ   #16,D1
    MOVEQ   #92,D0
    TRAP    #15
    MOVEQ   #96,D0
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START