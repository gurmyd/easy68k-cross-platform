* @item trap15-b 7 tasks 88, 91 and 89: filled ellipse centre, outline ellipse
* @item centre (background kept), a flood fill inside an outline rectangle and
* @item outside it
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVE.L  #$00FFFF00,D1
    MOVEQ   #80,D0
    TRAP    #15
    MOVE.L  #$00FF00FF,D1
    MOVEQ   #81,D0
    TRAP    #15
    MOVE.W  #20,D1
    MOVE.W  #20,D2
    MOVE.W  #120,D3
    MOVE.W  #90,D4
    MOVEQ   #88,D0
    TRAP    #15
    MOVE.W  #200,D1
    MOVE.W  #20,D2
    MOVE.W  #300,D3
    MOVE.W  #90,D4
    MOVEQ   #91,D0
    TRAP    #15
    MOVE.W  #20,D1
    MOVE.W  #200,D2
    MOVE.W  #120,D3
    MOVE.W  #300,D4
    MOVEQ   #90,D0
    TRAP    #15
    MOVE.L  #$00008080,D1
    MOVEQ   #81,D0
    TRAP    #15
    MOVE.W  #70,D1
    MOVE.W  #250,D2
    MOVEQ   #89,D0
    TRAP    #15
    LEA     NAMES,A1
    LEA     POINTS,A3
LOOP:
    MOVE.W  (A3)+,D1
    BMI     DONE
    MOVE.W  (A3)+,D2
    BSR     PIX
NEXT:
    TST.B   (A1)+
    BNE     NEXT
    BRA     LOOP
DONE:
    JSR     DMP_CLOSE
    SIMHALT
POINTS DC.W 70,55, 22,22, 250,55, 70,250, 30,210, 200,250, -1
NAMES  DC.B 'ellipse',0,'ellipseCorner',0,'outlineCentre',0,'flooded',0,'floodedCorner',0,'outside',0
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