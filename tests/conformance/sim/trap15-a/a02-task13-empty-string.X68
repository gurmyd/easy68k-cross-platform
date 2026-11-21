* @item trap15-a 13 Text output: task 13 with an empty string moves the cursor
* @item to column 0 of the next row; task 14 with an empty string does nothing
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     XYZ,A1
    MOVEQ   #14,D0
    TRAP    #15
    LEA     EMPTY,A1
    MOVEQ   #14,D0
    TRAP    #15
    JSR     DMP_POS
    MOVEQ   #13,D0
    TRAP    #15
    JSR     DMP_POS
    MOVEQ   #13,D0
    TRAP    #15
    JSR     DMP_POS
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
XYZ   DC.B  'XYZ',0
EMPTY DC.B  0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START