* @item trap15-a 13 Input: task 22 after task 14 'HI' at home with D1 = 1 gives
* @item D1 = $00000049 (bits 31..8 kept); row >= 128 reads row 127, column
* @item >= 256 reads 255; a never-written cell after the start-up clear is a space
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     HI,A1
    MOVEQ   #14,D0
    TRAP    #15
    LEA     CASES,A2
LOOP:
    MOVE.L  (A2)+,D1
    CMP.L   #-1,D1
    BEQ     DONE
    MOVEQ   #22,D0
    TRAP    #15
    LEA     GOT,A1
    JSR     DMP_VAL
    BRA     LOOP
DONE:
    JSR     DMP_CLOSE
    SIMHALT
CASES DC.L  $00000001,$00000000,$00000002,$00050007,$00800000,$00FF0000,$00000100,$0000FFFF,$FFFF0001,-1
HI    DC.B  'HI',0
GOT   DC.B  'D1',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START