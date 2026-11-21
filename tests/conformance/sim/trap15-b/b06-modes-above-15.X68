* @item trap15-b 15 V8: modes 18-255 index the table of 5.4 without a range
* @item check (mode 20 and 22: red pixel on black, read back), and modes 16, 17
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     MODES,A3
LOOP:
    MOVE.W  (A3)+,D7
    BMI     DONE
    MOVEQ   #4,D1
    MOVEQ   #92,D0
    TRAP    #15
    MOVEQ   #0,D1
    MOVEQ   #80,D0
    TRAP    #15
    MOVE.W  #50,D1
    MOVE.W  #50,D2
    MOVEQ   #82,D0
    TRAP    #15
    MOVEQ   #0,D1
    MOVE.W  D7,D1
    MOVEQ   #92,D0
    TRAP    #15
    MOVE.L  #$000000FF,D1
    MOVEQ   #80,D0
    TRAP    #15
    MOVE.W  #50,D1
    MOVE.W  #50,D2
    MOVEQ   #82,D0
    TRAP    #15
    MOVEQ   #83,D0
    TRAP    #15
    MOVE.L  D0,D6
    MOVE.L  D7,D5
    JSR     DMP_REGS
    MOVEQ   #16,D1
    MOVEQ   #92,D0
    TRAP    #15
    BRA     LOOP
DONE:
    JSR     DMP_CLOSE
    SIMHALT
MODES DC.W  20,22,18,19,21,23,-1
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START