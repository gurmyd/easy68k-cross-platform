* @item trap15-a 5 task 33 / trap15-b 4.3: a window size change blacks the
* @item surface (graphics pixel read back), keeps the pen position (task 96)
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVE.L  #$00FFFFFF,D1
    MOVEQ   #80,D0
    TRAP    #15
    MOVE.W  #30,D1
    MOVE.W  #30,D2
    MOVEQ   #82,D0
    TRAP    #15
    MOVE.W  #77,D1
    MOVE.W  #66,D2
    MOVEQ   #86,D0
    TRAP    #15
    LEA     BEFORE,A1
    MOVE.W  #30,D1
    MOVE.W  #30,D2
    BSR     PIX
    MOVE.L  #$03200258,D1
    MOVEQ   #33,D0
    TRAP    #15
    LEA     AFTER,A1
    MOVE.W  #30,D1
    MOVE.W  #30,D2
    BSR     PIX
    LEA     NEW,A1
    MOVE.W  #700,D1
    MOVE.W  #500,D2
    BSR     PIX
    MOVEQ   #96,D0
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
BEFORE DC.B 'before',0
AFTER  DC.B 'after',0
NEW    DC.B 'newArea',0
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