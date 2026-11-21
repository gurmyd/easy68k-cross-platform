* @item trap15-a 13 Text output: task 14 with 'AB',0 at home puts A at (0,0),
* @item B at (0,1), cursor (0,2); task 11 get returns D1.W = $0200 and keeps
* @item bits 31..16 of D1
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     AB,A1
    MOVEQ   #14,D0
    TRAP    #15
    MOVE.L  #$ABCD0000,D1
    MOVE.W  #$00FF,D1
    MOVEQ   #11,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.W  #0,D1
    MOVE.W  #4,D2
    JSR     DMP_ROW
    JSR     DMP_CLOSE
    SIMHALT
AB  DC.B    'AB',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START