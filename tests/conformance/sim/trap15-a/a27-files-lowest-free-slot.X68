* @item trap15-a 13 Files: task 52 't.bin' gives D0.W = 0 and a FID; a second
* @item task 52 the next FID; close the first and open another: the lowest free
* @item slot again (result.bin, opened first, holds one slot); D0 bits 31..16 kept
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     T,A1
    MOVE.L  #$ABCD0034,D0
    MOVE.B  #52,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  D1,D6
    LEA     U,A1
    MOVEQ   #52,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  D1,D5
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
    JSR     DMP_REGS
    LEA     V,A1
    MOVEQ   #52,D0
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
T   DC.B    't.bin',0
U   DC.B    'u.bin',0
V   DC.B    'v.bin',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START