* @item trap15-b 15 V3: task 82 obeys the drawing mode (white filled rectangle,
* @item mode 14, pen white, task 82 inside, task 83 there should be 0); and in
* @item the copy mode
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVE.L  #$00FFFFFF,D1
    MOVEQ   #80,D0
    TRAP    #15
    MOVEQ   #81,D0
    TRAP    #15
    MOVE.W  #100,D1
    MOVE.W  #100,D2
    MOVE.W  #200,D3
    MOVE.W  #200,D4
    MOVEQ   #87,D0
    TRAP    #15
    MOVEQ   #14,D1
    MOVEQ   #92,D0
    TRAP    #15
    MOVE.W  #150,D1
    MOVE.W  #150,D2
    MOVEQ   #82,D0
    TRAP    #15
    LEA     XOR,A1
    BSR     PIX
    MOVEQ   #4,D1
    MOVEQ   #92,D0
    TRAP    #15
    MOVE.L  #$00123456,D1
    MOVEQ   #80,D0
    TRAP    #15
    MOVE.W  #160,D1
    MOVE.W  #160,D2
    MOVEQ   #82,D0
    TRAP    #15
    LEA     COPY,A1
    BSR     PIX
    JSR     DMP_CLOSE
    SIMHALT
XOR  DC.B   'mode14',0
COPY DC.B   'mode4',0
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