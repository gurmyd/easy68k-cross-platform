* @item trap15-a 13 Text output: task 6 with $09 at column 0 moves to column 5;
* @item $08 at column 0 stays at 0; $08 after ABC puts the cursor on the C and
* @item the C stays; $0D goes to column 0; $07 does not move the cursor
* @recipe report outlog
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVEQ   #6,D0
    MOVEQ   #9,D1
    TRAP    #15
    JSR     DMP_POS
    MOVE.W  #$0001,D1
    MOVEQ   #11,D0
    TRAP    #15
    MOVEQ   #6,D0
    MOVEQ   #8,D1
    TRAP    #15
    JSR     DMP_POS
    LEA     ABC,A1
    MOVEQ   #14,D0
    TRAP    #15
    MOVEQ   #6,D0
    MOVEQ   #8,D1
    TRAP    #15
    JSR     DMP_POS
    MOVEQ   #7,D1
    TRAP    #15
    JSR     DMP_POS
    MOVEQ   #13,D1
    TRAP    #15
    JSR     DMP_POS
    MOVE.W  #1,D1
    MOVE.W  #8,D2
    JSR     DMP_ROW
    JSR     DMP_CLOSE
    SIMHALT
ABC DC.B    'ABC',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START