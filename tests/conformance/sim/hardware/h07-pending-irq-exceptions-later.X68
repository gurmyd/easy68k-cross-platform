* @item hardware 13 item 26: exceptions off at the start, mask 0, vector
* @item installed: an auto interrupt is latched (not taken) while the program
* @item runs; task 32/5 enables exceptions and the pending interrupt is taken at
* @item the end of that TRAP, stacking the address after the TRAP
    ORG     $1000
START:
    MOVE.L  #IRQ1,$64
    JSR     DMP_OPEN
    MOVE.B  #$81,D2
    MOVE.L  #10,D3
    MOVEQ   #6,D1
    MOVEQ   #32,D0
    TRAP    #15
    MOVEQ   #5,D1
    MOVEQ   #23,D0
    TRAP    #15
    MOVEQ   #0,D2
    MOVEQ   #6,D1
    MOVEQ   #32,D0
    TRAP    #15
    MOVE.L  COUNT,D5
    MOVEQ   #5,D1
    MOVEQ   #32,D0
    TRAP    #15
AFTER:
    NOP
    MOVE.L  STACKED,D1
    LEA     PCT,A1
    JSR     DMP_VAL
    LEA     AFTER,A0
    MOVE.L  A0,D1
    LEA     AFTERT,A1
    JSR     DMP_VAL
    MOVE.L  D5,D1
    LEA     BEFORE,A1
    JSR     DMP_VAL
    JSR     DMP_CLOSE
    SIMHALT
IRQ1:
    ADDQ.L  #1,COUNT
    MOVE.L  2(SP),STACKED
    RTE
COUNT   DC.L 0
STACKED DC.L 0
PCT     DC.B 'stackedPC',0
AFTERT  DC.B 'after',0
BEFORE  DC.B 'takenBefore',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START