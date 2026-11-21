* @item trap15-a 13 Files: task 51 on a missing file gives D0.W = 2 and
* @item D1 = $FFFFFFFF, and the file is not created (task 59 afterwards: 2)
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     MISSING,A1
    MOVE.L  #$55550033,D0
    MOVEQ   #-7,D1
    TRAP    #15
    JSR     DMP_REGS
    LEA     MISSING,A1
    MOVEQ   #59,D0
    MOVEQ   #-7,D1
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
MISSING DC.B 'no-such-file.dat',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START