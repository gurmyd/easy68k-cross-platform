* @item sim-core 1.5 / 3.13: memory the program never loaded holds $FF (unused
* @item words read as SIMHALT); the vector table too
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     $0,A0
    MOVEQ   #32,D0
    JSR     DMP_MEM
    LEA     $20000,A0
    MOVEQ   #16,D0
    JSR     DMP_MEM
    LEA     $FFFFF0,A0
    MOVEQ   #16,D0
    JSR     DMP_MEM
    JSR     DMP_CLOSE
    SIMHALT
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START