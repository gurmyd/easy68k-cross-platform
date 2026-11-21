* @item trap15-a 13 Input: task 7 with no key pending gives D1.B = 0 and keeps
* @item bits 31..8 of D1; task 19 with D1 = 0 (no key since the start) and with
* @item four key codes (none held) gives 0
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVE.L  #$ABCDEF55,D1
    MOVEQ   #7,D0
    TRAP    #15
    MOVE.L  D1,D5
    MOVEQ   #0,D1
    MOVEQ   #19,D0
    TRAP    #15
    MOVE.L  D1,D6
    MOVE.L  #$41534446,D1
    MOVEQ   #19,D0
    TRAP    #15
    MOVE.L  D1,D7
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START