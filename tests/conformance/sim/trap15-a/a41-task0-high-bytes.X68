* @item trap15-a 3.4: bytes $80-$FF are printable in tasks 13, 14 and 0; they
* @item are stored in the text array and written to the output log
* @recipe report outlog
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     HIGH,A1
    MOVEQ   #13,D0
    TRAP    #15
    LEA     HIGH,A1
    MOVE.W  #4,D1
    MOVEQ   #0,D0
    TRAP    #15
    MOVEQ   #0,D1
    MOVE.W  #16,D2
    JSR     DMP_ROW
    MOVEQ   #1,D1
    JSR     DMP_ROW
    JSR     DMP_POS
    JSR     DMP_CLOSE
    SIMHALT
HIGH DC.B   $80,$81,$9F,$A0,$C4,$E9,$F7,$FE,$FF,$7F,'end',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START