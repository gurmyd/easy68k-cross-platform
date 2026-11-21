* @item trap15-a 13 Text output: after task 81 (fill colour blue) printed spaces
* @item have blue cell backgrounds (task 83 inside the cell); task 11 $FF00
* @item clears to black, not to the fill colour
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVE.L  #$00FF0000,D1
    MOVEQ   #81,D0
    TRAP    #15
    LEA     SPACES,A1
    MOVEQ   #14,D0
    TRAP    #15
    MOVE.W  #2,D1
    MOVE.W  #2,D2
    MOVEQ   #83,D0
    TRAP    #15
    LEA     CELL,A1
    MOVE.L  D0,D1
    JSR     DMP_VAL
    MOVE.W  #200,D1
    MOVE.W  #200,D2
    MOVEQ   #83,D0
    TRAP    #15
    LEA     FAR,A1
    MOVE.L  D0,D1
    JSR     DMP_VAL
    MOVE.W  #$FF00,D1
    MOVEQ   #11,D0
    TRAP    #15
    MOVE.W  #2,D1
    MOVE.W  #2,D2
    MOVEQ   #83,D0
    TRAP    #15
    LEA     CLEARED,A1
    MOVE.L  D0,D1
    JSR     DMP_VAL
    JSR     DMP_POS
    JSR     DMP_CLOSE
    SIMHALT
SPACES  DC.B '    ',0
CELL    DC.B 'cell',0
FAR     DC.B 'far',0
CLEARED DC.B 'cleared',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START