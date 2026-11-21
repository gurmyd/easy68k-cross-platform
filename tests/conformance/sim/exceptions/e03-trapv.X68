* @item sim-core 3.9 TRAPV: no trap with V clear (4 cycles), trap through $1C with
* @item V set (stacked PC after the instruction)
* @switches /e
    ORG     $1000
START:
    MOVE.L  #H6,$1C
    JSR     DMP_OPEN
    MOVE.L  #C1,CONT
    MOVE    #$00,CCR
    JSR     DMP_CLRC
    TRAPV
    JSR     DMP_CYC
    MOVE    #$02,CCR
    JSR     DMP_CLRC
    TRAPV
C1  JSR     DMP_CLOSE
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