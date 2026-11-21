* @item trap15-a 13 Text output: printable characters past the right edge with
* @item wrap off: the cursor column keeps growing (task 11 get), nothing goes to
* @item the next row on screen, and task 22 at (1,0) reads the character stored
* @item past the edge (stride aliasing, 3.7); the column saturates at 255
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVE.W  #100,D7
LOOP:
    LEA     TEN,A1
    MOVEQ   #14,D0
    TRAP    #15
    SUBQ.W  #1,D7
    CMP.W   #92,D7
    BNE     LOOP
    JSR     DMP_POS
    MOVE.W  #0,D1
    MOVE.W  #82,D2
    JSR     DMP_ROW
    MOVE.W  #1,D1
    JSR     DMP_ROW
LOOP2:
    LEA     TEN,A1
    MOVEQ   #14,D0
    TRAP    #15
    SUBQ.W  #1,D7
    BNE     LOOP2
    JSR     DMP_POS
    JSR     DMP_CLOSE
    SIMHALT
TEN DC.B    '0123456789',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START