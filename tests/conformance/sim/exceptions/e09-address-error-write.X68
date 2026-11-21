* @item sim-core 3.8/3.9 address error on a write: stacked PC = opcode address
* @item + 2, information word without the READ bit; MOVE.W, MOVE.L and CLR.W to
* @item an odd address
* @switches /e
    ORG     $1000
START:
    MOVE.L  #H14,$C
    JSR     DMP_OPEN
    LEA     DATA+1,A0
    MOVE.L  #C1,CONT
    JSR     DMP_CLRC
    MOVE.W  D0,(A0)
C1  MOVE.L  #C2,CONT
    MOVE.L  #$12345678,4(A0)
C2  MOVE.L  #C3,CONT
    CLR.W   (A0)
C3  LEA     DATA,A0
    MOVEQ   #8,D0
    JSR     DMP_MEM
    JSR     DMP_CLOSE
    SIMHALT
DATA DC.L   $11223344,$55667788
    DS.W    0
* H6: handler for a 6-byte frame: registers, cycles, the frame, then resume at CONT
H6:
    JSR     DMP_CYC
    JSR     DMP_REGS
    MOVEM.L D0/A0,-(SP)
    LEA     8(SP),A0
    MOVEQ   #6,D0
    JSR     DMP_MEM
    MOVEM.L (SP)+,D0/A0
    MOVE.L  CONT,2(SP)
    ANDI.W  #$7FFF,(SP)         ; T off in the SR that RTE restores
    RTE
* H14: handler for the 14-byte frame of a bus or address error
H14:
    JSR     DMP_CYC
    JSR     DMP_REGS
    MOVEM.L D0/A0,-(SP)
    LEA     8(SP),A0
    MOVEQ   #14,D0
    JSR     DMP_MEM
    MOVEM.L (SP)+,D0/A0
    ADDQ.L  #8,SP
    MOVE.L  CONT,2(SP)
    RTE
CONT DC.L   0
    INCLUDE '..\dumplib.X68'
    END     START