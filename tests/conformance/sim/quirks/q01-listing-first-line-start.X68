* @item sim-ui 19 Q13: the listing's first line overrides the S-record start
* @item address (the program starts at $1000, not at START; D7 tells which)
    ORG     $1000
FIRST:
    MOVEQ   #1,D7
    BRA     COMMON
START:
    MOVEQ   #2,D7
COMMON:
    JSR     DMP_OPEN
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START