* @item trap15-a 3.2/3.7: the text grid of the default font, read through the
* @item stride of task 22 (81st character of row 0 = row 1, column 0) and the
* @item last row (task 11 to row 99 scrolls once and stops at the last row)
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVEQ   #0,D1
    MOVEQ   #33,D0
    TRAP    #15
    LEA     T33,A1
    JSR     DMP_VAL
    LEA     STR,A1
    MOVEQ   #14,D0
    TRAP    #15
    JSR     DMP_POS
    MOVE.W  #0,D1
    MOVE.W  #100,D2
    JSR     DMP_ROW
    MOVE.W  #1,D1
    MOVE.W  #30,D2
    JSR     DMP_ROW
    MOVE.W  #$0063,D1
    MOVEQ   #11,D0
    TRAP    #15
    JSR     DMP_POS
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
T33 DC.B    'T33',0
STR DC.B    '!"#$%&()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\]^_`abcdefghijklmnopqrstuvwxyz{|}~ABCDEFGH',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START