* @item trap15-a 4 task 11 $FF00: clear screen - cursor to 0,0, text array all
* @item spaces (stride 256, so even aliased cells), pixels black, D1 unchanged
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVE.L  #$000000FF,D1
    MOVEQ   #80,D0
    TRAP    #15
    MOVE.W  #10,D1
    MOVE.W  #10,D2
    MOVE.W  #600,D3
    MOVE.W  #400,D4
    MOVEQ   #87,D0
    TRAP    #15
    MOVEQ   #9,D7
FILLP:
    LEA     LINE,A1
    MOVEQ   #13,D0
    TRAP    #15
    DBRA    D7,FILLP
    MOVE.L  #$5555FF00,D1
    MOVEQ   #11,D0
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_POS
    MOVEQ   #0,D1
    MOVE.W  #100,D2
    JSR     DMP_ROW
    MOVEQ   #9,D1
    JSR     DMP_ROW
    MOVE.W  #50,D1
    MOVE.W  #50,D2
    MOVEQ   #83,D0
    TRAP    #15
    LEA     PIX,A1
    MOVE.L  D0,D1
    JSR     DMP_VAL
    JSR     DMP_CLOSE
    SIMHALT
LINE DC.B   'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',0
PIX  DC.B   'pixel',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START