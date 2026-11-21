* @item trap15-a 12 item 8 / T4 defect report D1: tasks 0 and 1 with a negative
* @item D1.W ($FFFF, $8000, $FF00) on a 300-byte string and on a short one, each
* @item after a different instruction (NOP, MULU, RTS, MOVE.L (SP)+): what the
* @item official program prints (the output log has the exact bytes)
* @recipe outlog report
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     LONG,A1
    MOVE.W  #-1,D1
    MOVEQ   #1,D0
    NOP
    TRAP    #15
    JSR     DMP_POS
    MOVEQ   #13,D1
    MOVEQ   #6,D0
    TRAP    #15
    MOVEQ   #10,D1
    TRAP    #15
    LEA     LONG,A1
    MOVE.W  #$8000,D1
    MOVEQ   #0,D0
    MULU    #3,D7
    TRAP    #15
    JSR     DMP_POS
    LEA     LONG,A1
    MOVE.W  #$FF00,D1
    MOVEQ   #0,D0
    BSR     ATRTS
    TRAP    #15
    JSR     DMP_POS
    LEA     LONG,A1
    MOVE.W  #-1,D1
    MOVEQ   #0,D0
    MOVE.L  #5,-(SP)
    MOVE.L  (SP)+,D5
    TRAP    #15
    JSR     DMP_POS
    LEA     HELLO,A1
    MOVE.W  #-1,D1
    MOVEQ   #0,D0
    NOP
    TRAP    #15
    JSR     DMP_POS
    MOVE.W  #2,D1
    MOVE.W  #60,D2
    JSR     DMP_ROW
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
ATRTS RTS
HELLO DC.B  'HELLO',0
LONG  DCB.B 300,'A'
      DC.B  'Z',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START