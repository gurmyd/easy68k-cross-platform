* @item trap15-a 4 task 0: D1.W = 0 prints nothing but does the CR LF; a NUL
* @item first byte with a count; task 1 with D1.W = 1 prints one character
* @recipe report outlog
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     ABC,A1
    MOVEQ   #0,D1
    MOVEQ   #0,D0
    TRAP    #15
    JSR     DMP_POS
    LEA     NUL,A1
    MOVEQ   #10,D1
    MOVEQ   #0,D0
    TRAP    #15
    JSR     DMP_POS
    LEA     ABC,A1
    MOVEQ   #1,D1
    MOVEQ   #1,D0
    TRAP    #15
    JSR     DMP_POS
    MOVEQ   #0,D1
    MOVE.W  #4,D2
    JSR     DMP_ROW
    MOVEQ   #2,D1
    JSR     DMP_ROW
    JSR     DMP_CLOSE
    SIMHALT
ABC DC.B    'ABC',0
NUL DC.B    0,'XYZ',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START