* @item trap15-a 4 task 21 with a colour only (high word of D2 = 0) keeps the
* @item Options font and with it the grid; the cursor keeps row and column
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     TXT,A1
    MOVEQ   #14,D0
    TRAP    #15
    MOVE.L  #$000000FF,D1
    MOVEQ   #0,D2
    MOVEQ   #21,D0
    TRAP    #15
    JSR     DMP_POS
    MOVE.L  #$0000FF00,D1
    MOVEQ   #5,D2
    MOVEQ   #21,D0
    TRAP    #15
    JSR     DMP_POS
    LEA     TXT,A1
    MOVEQ   #14,D0
    TRAP    #15
    JSR     DMP_POS
    MOVEQ   #0,D1
    MOVE.W  #10,D2
    JSR     DMP_ROW
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
TXT DC.B    'abc',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START