* @item trap15-a 13 Timing: MOVEQ #30,D0 / TRAP #15 / MOVEQ #31,D0 / TRAP #15
* @item gives D1 = 4 (TRAP #15 tasks cost no cycles); and a few instructions
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVEQ   #30,D0
    TRAP    #15
    MOVEQ   #31,D0
    TRAP    #15
    MOVE.L  D1,D7
    MOVEQ   #30,D0
    TRAP    #15
    NOP
    MULU    D7,D7
    MOVEQ   #31,D0
    TRAP    #15
    MOVE.L  D1,D6
    MOVEQ   #30,D0
    TRAP    #15
    MOVEQ   #13,D0
    LEA     TXT,A1
    TRAP    #15
    MOVEQ   #31,D0
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
TXT DC.B    'x',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START