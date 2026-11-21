* @item trap15-b 7 task 83 outside the surface ($FFFFFFFF), at the corners; task
* @item 82 outside does nothing
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     NAMES,A1
    LEA     POINTS,A3
LOOP:
    MOVE.W  (A3)+,D1
    CMP.W   #$7FFF,D1
    BEQ     DONE
    MOVE.W  (A3)+,D2
    MOVEQ   #82,D0
    TRAP    #15
    BSR     PIX
NEXT:
    TST.B   (A1)+
    BNE     NEXT
    BRA     LOOP
DONE:
    JSR     DMP_CLOSE
    SIMHALT
POINTS DC.W 0,0, 639,479, 640,0, 0,480, -1,5, 5,-1, 1000,1000, $7FFF
NAMES  DC.B 'tl',0,'br',0,'x640',0,'y480',0,'xm1',0,'ym1',0,'far',0
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