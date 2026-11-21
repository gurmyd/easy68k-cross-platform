* @item sim-core 3.9 TRAP #0 to #14: vector $80 + 4n, class 2, stacked PC after
* @item the TRAP, 38 cycles; the handler sees the supervisor stack
* @switches /e
    ORG     $1000
START:
    LEA     $80,A0
    MOVEQ   #14,D0
VEC:
    MOVE.L  #H6,(A0)+
    DBRA    D0,VEC
    JSR     DMP_OPEN
    MOVE.L  #C0,CONT
    JSR     DMP_CLRC
    TRAP    #0
C0  MOVE.L  #C1,CONT
    TRAP    #1
C1  MOVE.L  #C7,CONT
    TRAP    #7
C7  MOVE.L  #C14,CONT
    TRAP    #14
C14 JSR     DMP_CLOSE
    SIMHALT
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