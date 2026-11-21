* @item trap15-b 11 tasks 70, 71, 72, 76 with a file that does not exist and a
* @item slot that holds no sound: the result in D0 (no sound plays)
* @owner SH5
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     NOFILE,A1
    MOVEQ   #70,D0
    TRAP    #15
    JSR     DMP_REGS
    LEA     NOFILE,A1
    MOVEQ   #3,D1
    MOVEQ   #71,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVEQ   #3,D1
    MOVEQ   #72,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVEQ   #7,D1
    MOVEQ   #72,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVEQ   #3,D1
    MOVEQ   #2,D2
    MOVEQ   #76,D0
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
NOFILE DC.B 'no-such-sound.wav',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START