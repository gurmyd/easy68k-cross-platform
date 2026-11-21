* @item trap15-a 13 Files: tasks 53, 54, 55 and 56 with FID 8, -1 or a closed
* @item FID give D0.W = 2
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     NAME,A1
    MOVEQ   #52,D0
    TRAP    #15
    MOVE.L  D1,D6
    MOVEQ   #56,D0
    TRAP    #15
    LEA     FIDS,A3
LOOP:
    MOVE.L  (A3)+,D5
    CMP.L   #$7FFF,D5
    BEQ     DONE
    MOVEQ   #53,D7
TASKS:
    MOVE.L  D5,D1
    CMP.L   #$CCCC,D1
    BNE     SET
    MOVE.L  D6,D1
SET:
    LEA     BUF,A1
    MOVEQ   #4,D2
    MOVE.L  D7,D0
    TRAP    #15
    JSR     DMP_REGS
    ADDQ.L  #1,D7
    CMP.L   #57,D7
    BNE     TASKS
    BRA     LOOP
DONE:
    JSR     DMP_CLOSE
    SIMHALT
FIDS DC.L   8,-1,$CCCC,$7FFF
NAME DC.B   'closed.bin',0
    DS.W    0
BUF  DS.B   8
    INCLUDE '..\dumplib.X68'
    END     START