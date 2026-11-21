* @item trap15-a 13 Cursor: task 11 with D1.W = $0A05 goes to column 10, row 5;
* @item $0A28 (row 40) past the last row scrolls once to the last row; $8005
* @item gives column 0, row 5; $00FF gets, keeping bits 31..16; a column far
* @item past the right edge with wrap off ($7F02)
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     TOP,A1
    MOVEQ   #14,D0
    TRAP    #15
    LEA     CASES,A2
LOOP:
    MOVE.W  (A2)+,D1
    BEQ     DONE
    MOVEQ   #11,D0
    TRAP    #15
    LEA     STAR,A1
    MOVEQ   #14,D0
    TRAP    #15
    MOVE.L  #$12340000,D1
    MOVE.W  #$00FF,D1
    MOVEQ   #11,D0
    TRAP    #15
    LEA     GOT,A1
    JSR     DMP_VAL
    BRA     LOOP
DONE:
    MOVEQ   #0,D1
    MOVE.W  #12,D2
    JSR     DMP_ROW
    MOVEQ   #4,D1
    JSR     DMP_ROW
    MOVEQ   #5,D1
    JSR     DMP_ROW
    JSR     DMP_CLOSE
    SIMHALT
CASES DC.W  $0A05,$0A28,$8005,$0580,$7F02,$0103,0
TOP   DC.B  'TOP',0
STAR  DC.B  '*',0
GOT   DC.B  'D1',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START