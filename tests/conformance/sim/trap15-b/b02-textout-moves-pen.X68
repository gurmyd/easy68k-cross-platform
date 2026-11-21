* @item trap15-b 15 V2: task 95 moves the pen to the end of the text (task 86
* @item (0,0); task 95 "WW" at (50,60); task 96 gives (50 + width, 60))
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVEQ   #0,D1
    MOVEQ   #0,D2
    MOVEQ   #86,D0
    TRAP    #15
    LEA     WW,A1
    MOVE.W  #50,D1
    MOVE.W  #60,D2
    MOVEQ   #95,D0
    TRAP    #15
    MOVEQ   #96,D0
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
WW  DC.B    'WW',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START