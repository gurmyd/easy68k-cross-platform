* @item trap15-b 5.4 task 92 modes 0-15 (the 16 raster operations): a pixel of
* @item pen $00336699 drawn on $00F0F0F0 and on black, read back with task 83
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVEQ   #0,D7               ; mode
MODES:
    MOVEQ   #4,D1               ; copy mode for the background
    MOVEQ   #92,D0
    TRAP    #15
    MOVE.L  #$00F0F0F0,D1
    MOVEQ   #80,D0
    TRAP    #15
    MOVEQ   #81,D0
    TRAP    #15
    MOVE.W  #10,D1
    MOVE.W  #10,D2
    MOVE.W  #40,D3
    MOVE.W  #40,D4
    MOVEQ   #87,D0
    TRAP    #15
    MOVE.L  D7,D1
    MOVEQ   #92,D0
    TRAP    #15
    MOVE.L  #$00336699,D1
    MOVEQ   #80,D0
    TRAP    #15
    MOVE.W  #20,D1
    MOVE.W  #20,D2
    MOVEQ   #82,D0
    TRAP    #15
    MOVE.W  #300,D1
    MOVE.W  #300,D2
    MOVEQ   #82,D0
    TRAP    #15
    MOVE.W  #20,D1
    MOVE.W  #20,D2
    MOVEQ   #83,D0
    TRAP    #15
    MOVE.L  D0,D5
    MOVE.W  #300,D1
    MOVE.W  #300,D2
    MOVEQ   #83,D0
    TRAP    #15
    MOVE.L  D0,D6
    JSR     DMP_REGS
    MOVEQ   #4,D1               ; clear the black pixel again
    MOVEQ   #92,D0
    TRAP    #15
    MOVEQ   #0,D1
    MOVEQ   #80,D0
    TRAP    #15
    MOVE.W  #300,D1
    MOVE.W  #300,D2
    MOVEQ   #82,D0
    TRAP    #15
    ADDQ.L  #1,D7
    CMP.L   #16,D7
    BNE     MODES
    JSR     DMP_CLOSE
    SIMHALT
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START