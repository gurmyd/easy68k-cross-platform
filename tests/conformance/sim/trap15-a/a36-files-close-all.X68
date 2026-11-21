* @item trap15-a 13 Files: task 50 with nothing open gives 0; task 50 with two
* @item files open closes both (a write to the old FID then fails)
    ORG     $1000
START:
    MOVE.L  #$12340032,D0
    TRAP    #15
    MOVE.L  D0,D7
    LEA     A,A1
    MOVEQ   #52,D0
    TRAP    #15
    MOVE.L  D1,D6
    LEA     B,A1
    MOVEQ   #52,D0
    TRAP    #15
    MOVEQ   #50,D0
    TRAP    #15
    MOVE.L  D0,D5
    MOVE.L  D6,D1
    LEA     A,A1
    MOVEQ   #1,D2
    MOVEQ   #54,D0
    TRAP    #15
    MOVE.L  D0,D4
    JSR     DMP_OPEN
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
A   DC.B    'a.bin',0
B   DC.B    'b.bin',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START