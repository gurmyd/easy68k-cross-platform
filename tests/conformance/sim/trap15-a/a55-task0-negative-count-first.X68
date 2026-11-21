* @item trap15-a 12 item 8 / T4 defect report D1: task 0 with D1.W = -1 on a
* @item 300-byte string as the program's first TRAP #15, after NOP, then after
* @item MULU, MOVE.L (SP)+ and RTS, with no other task between them (what the
* @item official program prints; T4 saw 255 characters and one byte $C0 here)
* @recipe outlog
* @owner engine
    ORG     $1000
START:
    LEA     LONG,A1
    MOVE.W  #-1,D1
    MOVEQ   #0,D0
    NOP
    TRAP    #15
    LEA     LONG,A1
    MOVE.W  #-1,D1
    MOVEQ   #0,D0
    MOVE.W  #7,D3
    MULU    #300,D3
    TRAP    #15
    LEA     LONG,A1
    MOVE.W  #-1,D1
    MOVEQ   #0,D0
    MOVE.L  #$11223344,-(SP)
    MOVE.L  (SP)+,D5
    TRAP    #15
    LEA     LONG,A1
    MOVE.W  #-1,D1
    MOVEQ   #0,D0
    BSR     ATRTS
    TRAP    #15
    SIMHALT
ATRTS RTS
LONG  DCB.B 300,'A'
      DC.B  'Z',0
    END     START