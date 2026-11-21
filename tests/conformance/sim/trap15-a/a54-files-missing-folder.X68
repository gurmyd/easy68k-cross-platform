* @item trap15-a 11 item 14 / 13 Files: a name in a folder that does not exist
* @item ('nofolder\x.bin', 'nofolder/x.bin'): tasks 52, 51, 59 and 57 fail with
* @item D0.W = 2 (52 and 51 also D1 = $FFFFFFFF), and no file is created
* @owner SH6
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     BACKSL,A1
    BSR     TRYALL
    LEA     SLASH,A1
    BSR     TRYALL
    LEA     PLAIN,A1
    MOVEQ   #59,D0
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
* tasks 52, 51, 59, 57 on the name at A1; D1 = 0 before each
TRYALL:
    MOVE.L  A1,A2
    MOVEQ   #0,D1
    MOVEQ   #52,D0
    TRAP    #15
    JSR     DMP_REGS
    CMP.W   #0,D0
    BNE.S   TRY51
    MOVEQ   #56,D0
    TRAP    #15
TRY51:
    MOVE.L  A2,A1
    MOVEQ   #0,D1
    MOVEQ   #51,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  A2,A1
    MOVEQ   #0,D1
    MOVEQ   #59,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  A2,A1
    MOVEQ   #0,D1
    MOVEQ   #57,D0
    TRAP    #15
    JSR     DMP_REGS
    RTS
BACKSL DC.B  'nofolder\x.bin',0
SLASH  DC.B  'nofolder/x.bin',0
PLAIN  DC.B  'x.bin',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START