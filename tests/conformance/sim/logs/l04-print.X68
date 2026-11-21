* @item trap15-a tasks 0, 3, 6, 13, 15, 20 in an execution log with the output log
* @recipe log:2+out
* Moved from tests/oracle/wine/sim/tests/l4_print.X68 (the proof of official-oracle.md 5.2).
    ORG     $1000
START:

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

    SIMHALT

MSG1     DC.B   'Hello from the official simulator',0
MSG2     DC.B   'ABCDEFGH',0
MSG3     DC.B   'done.',0
    DS.W    0
    END     START
