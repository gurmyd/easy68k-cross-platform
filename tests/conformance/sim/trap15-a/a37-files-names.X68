* @item trap15-a 11 item 14: file names are Windows names: letter case does not
* @item matter, and '.\name' or a name with '/' finds the same file
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     MIXED,A1
    MOVEQ   #52,D0
    TRAP    #15
    MOVE.L  D1,D6
    LEA     DATA,A1
    MOVEQ   #3,D2
    MOVEQ   #54,D0
    TRAP    #15
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
    LEA     NAMES,A3
LOOP:
    TST.B   (A3)
    BEQ     DONE
    MOVEA.L A3,A1
    MOVEQ   #51,D0
    TRAP    #15
    MOVE.L  D1,D6
    LEA     BUF,A1
    MOVEQ   #3,D2
    MOVEQ   #53,D0
    TRAP    #15
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
    JSR     DMP_REGS
    LEA     BUF,A0
    MOVEQ   #4,D0
    JSR     DMP_MEM
NEXT:
    TST.B   (A3)+
    BNE     NEXT
    BRA     LOOP
DONE:
    JSR     DMP_CLOSE
    SIMHALT
MIXED DC.B  'MiXeD.Txt',0
NAMES DC.B  'mixed.txt',0,'MIXED.TXT',0,'.\mixed.txt',0,'./Mixed.TXT',0,0
DATA  DC.B  'xyz'
    DS.W    0
BUF   DS.B  4
    INCLUDE '..\dumplib.X68'
    END     START