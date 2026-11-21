*-----------------------------------------------------------
* t4_print: text output with TRAP #15 tasks 0,1,3,6,13,14,15,20
* (for the text-output log) plus a self-report of registers.
*-----------------------------------------------------------
    ORG     $1000
START:
    LEA     DUMPNAME,A1
    JSR     DMP_OPEN

    LEA     MSG1,A1
    MOVE.B  #13,D0
    TRAP    #15
    LEA     MSG2,A1
    MOVE.W  #5,D1
    MOVE.B  #0,D0               ; length-counted, with CR LF
    TRAP    #15
    MOVE.L  #-12345,D1
    MOVE.B  #3,D0               ; signed decimal
    TRAP    #15
    MOVE.B  #' ',D1
    MOVE.B  #6,D0
    TRAP    #15
    MOVE.L  #$BEEF,D1
    MOVE.B  #16,D2
    MOVE.B  #15,D0              ; unsigned in base 16
    TRAP    #15
    MOVE.B  #' ',D1
    MOVE.B  #6,D0
    TRAP    #15
    MOVE.L  #42,D1
    MOVE.B  #8,D2
    MOVE.B  #20,D0              ; signed, field width 8
    TRAP    #15
    LEA     MSG3,A1
    MOVE.B  #13,D0
    TRAP    #15
    JSR     DMP_REGS

    JSR     DMP_CLOSE
    SIMHALT

DUMPNAME DC.B   't4_print_dump.txt',0
MSG1     DC.B   'Hello from the official simulator',0
MSG2     DC.B   'ABCDEFGH',0
MSG3     DC.B   'done.',0
    DS.W    0
    INCLUDE 'dumplib.X68'
    END     START
