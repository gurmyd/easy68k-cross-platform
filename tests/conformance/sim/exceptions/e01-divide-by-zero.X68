* @item sim-core 3.9 divide by zero (exceptions enabled): vector $14, class 2,
* @item stacked PC = the address after the instruction, 42 cycles; DIVS and DIVU,
* @item register and memory divisor
* @switches /e
    ORG     $1000
START:
    MOVE.L  #H6,$14
    JSR     DMP_OPEN
    MOVE.L  #C1,CONT
    MOVE.L  #100,D0
    MOVEQ   #0,D1
    JSR     DMP_CLRC
    DIVU    D1,D0
C1  MOVE.L  #C2,CONT
    MOVE.L  #-100,D0
    JSR     DMP_CLRC
    DIVS    D1,D0
C2  MOVE.L  #C3,CONT
    LEA     ZERO,A0
    JSR     DMP_CLRC
    DIVU    2(A0),D0
C3  JSR     DMP_CLOSE
    SIMHALT
ZERO DC.L   0
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