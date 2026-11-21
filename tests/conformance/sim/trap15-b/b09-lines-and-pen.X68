* @item trap15-b 7 tasks 84, 85, 86, 96: horizontal and vertical lines (the
* @item last point is not drawn), line-to from the pen, pen positions
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVE.L  #$00FFFFFF,D1
    MOVEQ   #80,D0
    TRAP    #15
    MOVE.W  #10,D1
    MOVE.W  #10,D2
    MOVE.W  #20,D3
    MOVE.W  #10,D4
    MOVEQ   #84,D0
    TRAP    #15
    MOVEQ   #96,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.W  #20,D1
    MOVE.W  #30,D2
    MOVEQ   #85,D0
    TRAP    #15
    MOVEQ   #96,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.W  #100,D1
    MOVE.W  #100,D2
    MOVEQ   #86,D0
    TRAP    #15
    MOVE.W  #100,D1
    MOVE.W  #90,D2
    MOVEQ   #85,D0
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
POINTS DC.W 10,10, 15,10, 19,10, 20,10, 20,20, 20,29, 20,30, 100,100, 100,95, 100,90, -1
NAMES  DC.B 'h0',0,'h5',0,'h9',0,'hEnd',0,'v10',0,'v19',0,'vEnd',0,'u0',0,'u5',0,'uEnd',0
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