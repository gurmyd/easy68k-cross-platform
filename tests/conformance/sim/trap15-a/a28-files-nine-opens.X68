* @item trap15-a 13 Files: opens without closing until the table is full: the
* @item open that finds no free slot gives D0.W = 2 and D1 = $FFFFFFFF
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVEQ   #9,D7
    LEA     NAME,A2
LOOP:
    ADDQ.B  #1,4(A2)            ; f1.bin, f2.bin, ...
    MOVEA.L A2,A1
    MOVEQ   #52,D0
    TRAP    #15
    JSR     DMP_REGS
    SUBQ.W  #1,D7
    BNE     LOOP
    JSR     DMP_CLOSE
    SIMHALT
NAME DC.B   'file0.bin',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START