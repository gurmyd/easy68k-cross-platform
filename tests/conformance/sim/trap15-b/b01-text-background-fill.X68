* @item trap15-b 15 V1: text drawn with task 95 has the fill colour as its
* @item background (task 81 red, task 95 "A" at (10,10), task 83 at (10,10))
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVE.L  #$000000FF,D1
    MOVEQ   #81,D0
    TRAP    #15
    LEA     A,A1
    MOVE.W  #10,D1
    MOVE.W  #10,D2
    MOVEQ   #95,D0
    TRAP    #15
    LEA     P1,A1
    MOVE.W  #10,D1
    MOVE.W  #10,D2
    BSR     PIX
    LEA     P2,A1
    MOVE.W  #9,D1
    MOVE.W  #9,D2
    BSR     PIX
    JSR     DMP_CLOSE
    SIMHALT
A   DC.B    'A',0
P1  DC.B    'at10,10',0
P2  DC.B    'at9,9',0
    DS.W    0
* PIX: D1.W = x, D2.W = y; writes "name=colour" (task 83) with the name at A1
PIX:
    MOVEM.L D0-D2,-(SP)
    MOVEQ   #83,D0
    TRAP    #15
    MOVE.L  D0,D1
    JSR     DMP_VAL
    MOVEM.L (SP)+,D0-D2
    RTS
    INCLUDE '..\dumplib.X68'
    END     START