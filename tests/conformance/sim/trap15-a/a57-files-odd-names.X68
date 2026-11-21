* @item trap15-a 11 item 14 / 13 Files: Windows names: 'DATA.TXT.' and
* @item 'data.txt ' (a trailing dot or space) open 'data.txt' with task 51; a
* @item name with '?' or '*' with tasks 51, 52 and 59 (D0.W, and D1 of 51/52)
* @owner SH6
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     PLAIN,A1
    MOVEQ   #52,D0
    TRAP    #15
    LEA     DATA,A1
    MOVEQ   #3,D2
    MOVEQ   #54,D0
    TRAP    #15
    MOVEQ   #56,D0
    TRAP    #15
    LEA     DOT,A1
    BSR     READ3
    LEA     SPACE,A1
    BSR     READ3
    LEA     QUEST,A1
    BSR     TRY3
    LEA     STAR,A1
    BSR     TRY3
    LEA     PLAIN,A1
    MOVEQ   #57,D0
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
* task 51 on the name at A1; on success read 3 bytes, dump them, close
READ3:
    MOVEQ   #0,D1
    MOVEQ   #51,D0
    TRAP    #15
    JSR     DMP_REGS
    CMP.W   #0,D0
    BNE.S   READ3X
    MOVE.L  D1,D6
    LEA     BUF,A1
    MOVE.L  #$EEEEEEEE,(A1)
    MOVEQ   #3,D2
    MOVEQ   #53,D0
    TRAP    #15
    JSR     DMP_REGS
    LEA     BUF,A0
    MOVEQ   #4,D0
    JSR     DMP_MEM
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
READ3X:
    RTS
* tasks 51, 52 (closed again if it opened) and 59 on the name at A1
TRY3:
    MOVE.L  A1,A2
    MOVEQ   #0,D1
    MOVEQ   #51,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  A2,A1
    MOVEQ   #0,D1
    MOVEQ   #52,D0
    TRAP    #15
    JSR     DMP_REGS
    CMP.W   #0,D0
    BNE.S   TRY3B
    MOVEQ   #56,D0
    TRAP    #15
    MOVE.L  A2,A1
    MOVEQ   #57,D0
    TRAP    #15
TRY3B:
    MOVE.L  A2,A1
    MOVEQ   #0,D1
    MOVEQ   #59,D0
    TRAP    #15
    JSR     DMP_REGS
    RTS
PLAIN DC.B  'data.txt',0
DOT   DC.B  'DATA.TXT.',0
SPACE DC.B  'data.txt ',0
QUEST DC.B  'd?ta.txt',0
STAR  DC.B  'd*.txt',0
DATA  DC.B  'xyz'
    DS.W    0
BUF   DCB.B 4,$EE
    INCLUDE '..\dumplib.X68'
    END     START