* @item trap15-a 4 tasks 12, 16, 24 and 62 change settings only: every register
* @item stays as it was (including D1 with any value, and D0)
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     CASES,A3
LOOP:
    MOVE.L  (A3)+,D0
    BMI     DONE
    MOVE.L  (A3)+,D1
    MOVE.L  #$22222222,D2
    TRAP    #15
    JSR     DMP_REGS
    BRA     LOOP
DONE:
    JSR     DMP_CLOSE
    SIMHALT
CASES DC.L  12,0, 12,$FFFFFF01, 16,0, 16,1, 16,2, 16,3, 16,$77, 24,1, 24,0, 24,2, 62,0, 60,0, -1
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START