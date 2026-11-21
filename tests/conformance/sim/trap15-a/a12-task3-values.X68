* @item trap15-a 13 Text output: task 3 with D1 = $FFFFFFFF prints -1; also
* @item $80000000, $7FFFFFFF and 0; registers unchanged
* @recipe report outlog
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     VALUES,A2
    MOVEQ   #4,D7
LOOP:
    MOVE.L  (A2)+,D1
    MOVEQ   #3,D0
    TRAP    #15
    MOVEQ   #' ',D1
    MOVEQ   #6,D0
    TRAP    #15
    SUBQ.W  #1,D7
    BNE     LOOP
    JSR     DMP_REGS
    MOVEQ   #0,D1
    MOVE.W  #44,D2
    JSR     DMP_ROW
    JSR     DMP_CLOSE
    SIMHALT
VALUES DC.L $FFFFFFFF,$80000000,$7FFFFFFF,0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START