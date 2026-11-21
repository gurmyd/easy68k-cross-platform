* @item trap15-a 13 Text output: task 15 with D1 = $FFFFFFFF in base 16 and 2;
* @item base 1 and 37 print nothing; D1 = 255 in base 36 prints 73; base 10;
* @item D2.B negative prints nothing; only D2.B counts ($0110 is base 16)
* @recipe report outlog
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     CASES,A2
LOOP:
    MOVE.L  (A2)+,D1
    MOVE.L  (A2)+,D2
    CMP.L   #-1,D2
    BEQ     DONE
    MOVEQ   #15,D0
    TRAP    #15
    JSR     DMP_POS
    MOVEQ   #13,D0
    LEA     NONE,A1
    TRAP    #15
    BRA     LOOP
DONE:
    MOVEQ   #0,D1
    MOVE.W  #36,D2
    JSR     DMP_ROW
    MOVEQ   #1,D1
    JSR     DMP_ROW
    JSR     DMP_CLOSE
    SIMHALT
CASES DC.L  $FFFFFFFF,16, $FFFFFFFF,2, 12345,1, 12345,37, 255,36, 4000000000,10
      DC.L  77,$82, $ABCDEF,$110, 0,16, 7,$FF000008, 0,-1
NONE  DC.B  0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START