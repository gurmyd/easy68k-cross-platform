* @item trap15-b 7 task 93: pen width 1, 3 and 6 for a horizontal line; the rows
* @item of x = 50 that hold the pen colour (scan)
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVE.L  #$0000FFFF,D1
    MOVEQ   #80,D0
    TRAP    #15
    LEA     WIDTHS,A3
    MOVE.W  #40,D6
LOOP:
    MOVE.W  (A3)+,D1
    BMI     DONE
    MOVEQ   #93,D0
    TRAP    #15
    MOVE.W  #20,D1
    MOVE.W  D6,D2
    MOVE.W  #200,D3
    MOVE.W  D6,D4
    MOVEQ   #84,D0
    TRAP    #15
    ADD.W   #30,D6
    BRA     LOOP
DONE:
    MOVEQ   #0,D5
SCAN:
    MOVE.W  #50,D1
    MOVE.W  D5,D2
    MOVEQ   #83,D0
    TRAP    #15
    TST.L   D0
    BEQ     SKIP
    MOVE.L  D5,D1
    LEA     Y,A1
    JSR     DMP_VAL
SKIP:
    ADDQ.W  #1,D5
    CMP.W   #160,D5
    BNE     SCAN
    JSR     DMP_CLOSE
    SIMHALT
WIDTHS DC.W 1,3,6,-1
Y   DC.B    'y',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START