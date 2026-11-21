* @item trap15-a 13 Text output: task 6 with $0B (VT) two rows above the last
* @item row scrolls once and puts the cursor on the last row
* @recipe report outlog
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVE.W  #$007F,D1           ; last row
    MOVEQ   #11,D0
    TRAP    #15
    MOVE.W  #$00FF,D1
    TRAP    #15
    SUBQ.B  #2,D1               ; two rows above it
    AND.W   #$00FF,D1
    MOVE.W  D1,D6
    LSL.W   #8,D1
    LSR.W   #8,D1
    OR.W    #$0400,D1           ; column 4
    MOVEQ   #11,D0
    TRAP    #15
    LEA     MARK,A1
    MOVEQ   #14,D0
    TRAP    #15
    JSR     DMP_POS
    MOVEQ   #11,D1
    MOVEQ   #6,D0
    TRAP    #15
    JSR     DMP_POS
    MOVE.W  D6,D1
    SUBQ.W  #1,D1
    MOVE.W  #8,D2
    JSR     DMP_ROW
    JSR     DMP_CLOSE
    SIMHALT
MARK DC.B   'M',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START