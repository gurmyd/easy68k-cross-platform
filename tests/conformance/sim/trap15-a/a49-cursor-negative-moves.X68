* @item trap15-a 3.5: backspaces past column 0 stay at 0; HT past the right
* @item edge with wrap off goes on; LF and VT go down; CR at the end of a row
* @recipe report outlog
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     SEQ,A1
    MOVEQ   #14,D0
    TRAP    #15
    JSR     DMP_POS
    MOVEQ   #0,D5
ROWS:
    MOVE.W  D5,D1
    MOVE.W  #24,D2
    JSR     DMP_ROW
    ADDQ.W  #1,D5
    CMP.W   #7,D5
    BNE     ROWS
    LEA     TABS,A1
    MOVEQ   #14,D0
    TRAP    #15
    JSR     DMP_POS
    JSR     DMP_CLOSE
    SIMHALT
SEQ  DC.B   'ab',8,8,8,8,'X',10,'Y',11,'Z',13,'W',9,'T',8,'U',0
TABS DC.B   9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,9,'e',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START