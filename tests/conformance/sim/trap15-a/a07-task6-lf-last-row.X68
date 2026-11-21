* @item trap15-a 13 Text output: task 6 with $0A on the last row scrolls the
* @item screen one row; the cursor stays on the last row, same column
* @recipe report outlog
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     TOP,A1
    MOVEQ   #14,D0
    TRAP    #15
    MOVE.W  #$037F,D1           ; column 3, row 127: one scroll, last row
    MOVEQ   #11,D0
    TRAP    #15
    JSR     DMP_POS
    LEA     XY,A1
    MOVEQ   #14,D0
    TRAP    #15
    MOVEQ   #10,D1
    MOVEQ   #6,D0
    TRAP    #15
    JSR     DMP_POS
    MOVE.W  #$00FF,D1
    MOVEQ   #11,D0
    TRAP    #15
    MOVEQ   #0,D2
    MOVE.B  D1,D2               ; last row
    MOVE.W  D2,D1
    SUBQ.W  #1,D1
    MOVE.W  #8,D2
    JSR     DMP_ROW
    ADDQ.W  #1,D1
    JSR     DMP_ROW
    MOVEQ   #0,D1
    JSR     DMP_ROW
    JSR     DMP_CLOSE
    SIMHALT
TOP DC.B    'TOP',0
XY  DC.B    'XY',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START