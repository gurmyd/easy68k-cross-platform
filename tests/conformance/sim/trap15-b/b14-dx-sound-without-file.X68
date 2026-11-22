* @item trap15-b 11.4 tasks 73, 74, 75 and 77 (the DirectX player) with a file
* @item that does not exist and a slot that holds no sound: every task writes
* @item D0.W = 0 and keeps the high word; task 77 does nothing for an empty slot,
* @item whatever the command (0-3, and 4, which is no command); no sound plays
* @owner SH5
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     NOFILE,A1
    MOVE.L  #$ABCD0049,D0       ; task 73
    TRAP    #15
    JSR     DMP_REGS
    LEA     NOFILE,A1
    MOVE.L  #$12345603,D1
    MOVE.L  #$ABCD004A,D0       ; task 74 into slot 3
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  #$12345603,D1
    MOVE.L  #$ABCD004B,D0       ; task 75, slot 3
    TRAP    #15
    JSR     DMP_REGS
    MOVEQ   #0,D7               ; task 77 commands 0 to 4 on slot 3
CMDS:
    MOVEQ   #3,D1
    MOVE.L  D7,D2
    MOVE.L  #$ABCD004D,D0       ; task 77
    TRAP    #15
    JSR     DMP_REGS
    ADDQ.L  #1,D7
    CMPI.L  #5,D7
    BNE     CMDS
    JSR     DMP_CLOSE
    SIMHALT
NOFILE DC.B 'no-such-sound.wav',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START
