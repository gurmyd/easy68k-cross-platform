* @item trap15-b 7 tasks 87 and 90: filled and outline rectangles; pixels well
* @item inside, on the outline middle and outside (no edge pixels: Wine's GDI)
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVE.L  #$0000FF00,D1
    MOVEQ   #80,D0
    TRAP    #15
    MOVE.L  #$000000FF,D1
    MOVEQ   #81,D0
    TRAP    #15
    MOVE.W  #20,D1
    MOVE.W  #20,D2
    MOVE.W  #120,D3
    MOVE.W  #100,D4
    MOVEQ   #87,D0
    TRAP    #15
    MOVE.W  #200,D1
    MOVE.W  #20,D2
    MOVE.W  #300,D3
    MOVE.W  #100,D4
    MOVEQ   #90,D0
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
POINTS DC.W 70,60, 70,20, 20,60, 250,60, 250,20, 200,60, 400,60, -1
NAMES  DC.B 'fill',0,'fillTop',0,'fillLeft',0,'outlineIn',0,'outlineTop',0,'outlineLeft',0,'outside',0
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