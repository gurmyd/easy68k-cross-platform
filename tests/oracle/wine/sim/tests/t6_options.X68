*-----------------------------------------------------------
* t6_options: shows whether the simulator's "exceptions enabled" option
* is on. A divide by zero goes through vector 5 only when exceptions are
* enabled; the handler sets D7 = $E5E5E5E5. The report is written either way.
*-----------------------------------------------------------
    ORG     $1000
START:
    MOVE.L  #DIVZ,$14           ; vector 5: zero divide
    LEA     DUMPNAME,A1
    JSR     DMP_OPEN
    MOVEQ   #0,D7
    MOVE.L  #100,D0
    MOVEQ   #0,D1
    DIVU    D1,D0
    MOVE.L  #$600D600D,D6       ; reached after the division
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT

DIVZ:
    MOVE.L  #$E5E5E5E5,D7
    RTE

DUMPNAME DC.B   't6_options_dump.txt',0
    DS.W    0
    INCLUDE 'dumplib.X68'
    END     START
