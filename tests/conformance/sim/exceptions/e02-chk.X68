* @item sim-core 3.9/3.16 CHK with a trap: value above the bound and negative
* @item value; vector $18, stacked PC after the instruction; Z, V, C toggled
* @item (quirk); 44 + EA cycles
* @switches /e
    ORG     $1000
START:
    MOVE.L  #H6,$18
    JSR     DMP_OPEN
    MOVE.L  #C1,CONT
    MOVE.W  #200,D0
    MOVE.W  #100,D1
    MOVE    #$00,CCR
    JSR     DMP_CLRC
    CHK     D1,D0
C1  MOVE.L  #C2,CONT
    MOVE.W  #-3,D0
    MOVE    #$0F,CCR
    JSR     DMP_CLRC
    CHK     #50,D0
C2  MOVE.L  #C3,CONT
    MOVE.W  #5,D0
    MOVE.W  #-1,D1
    JSR     DMP_CLRC
    CHK     D1,D0
C3  JSR     DMP_REGS
    JSR     DMP_CLOSE
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