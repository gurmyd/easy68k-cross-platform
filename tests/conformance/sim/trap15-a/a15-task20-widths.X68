* @item trap15-a 13 Text output: task 20 with D1 = 42 and D2.B = 5 pads left,
* @item $FB (-5) pads right, 1 and 0 print 42; negative numbers; a field
* @item narrower than the number
* @recipe report outlog
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     CASES,A2
LOOP:
    MOVE.L  (A2)+,D1
    MOVE.L  (A2)+,D2
    CMP.L   #$7FFF,D2
    BEQ     DONE
    MOVEQ   #'[',D1
    MOVEQ   #6,D0
    TRAP    #15
    MOVE.L  -8(A2),D1
    MOVEQ   #20,D0
    TRAP    #15
    MOVEQ   #']',D1
    MOVEQ   #6,D0
    TRAP    #15
    BRA     LOOP
DONE:
    JSR     DMP_POS
    MOVEQ   #0,D1
    MOVE.W  #80,D2
    JSR     DMP_ROW
    JSR     DMP_CLOSE
    SIMHALT
CASES DC.L  42,5, 42,$FB, 42,1, 42,0, -42,6, -42,$FA, 123456,3, $80000000,12, 7,$1003
      DC.L  0,$7FFF
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START