* @item trap15-a 13 Timing: task 8 twice around a task 23 delay of 100 gives a
* @item difference of at least 100 (only the comparison is written: the clock
* @item itself differs between runs); task 23 changes no register
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVEQ   #8,D0
    TRAP    #15
    MOVE.L  D1,D6
    MOVEQ   #100,D1
    MOVEQ   #23,D0
    TRAP    #15
    MOVE.L  D1,D5               ; still 100
    MOVEQ   #8,D0
    TRAP    #15
    SUB.L   D6,D1
    BPL     POS
    ADD.L   #8640000,D1         ; past midnight
POS:
    CMP.L   #100,D1
    SHS     D7
    AND.L   #$FF,D7
    CMP.L   #8640000,D6
    SLO     D4
    AND.L   #$FF,D4
    MOVEQ   #0,D1
    MOVEQ   #0,D6
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START