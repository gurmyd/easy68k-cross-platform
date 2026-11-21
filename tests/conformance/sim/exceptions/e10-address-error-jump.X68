* @item sim-core 3.16 JMP/JSR read a word at the target: an odd target faults
* @item in the JMP itself (a read address error with the PC of the JMP); BRA to
* @item an odd address faults in the fetch (frame IR = previous opcode)
* @switches /e
    ORG     $1000
START:
    MOVE.L  #H14,$C
    JSR     DMP_OPEN
    MOVE.L  #C1,CONT
    LEA     ODD+1,A0
    JSR     DMP_CLRC
    JMP     (A0)
C1  MOVE.L  #C2,CONT
    JSR     ODD+1
C2  MOVE.L  #C3,CONT
    NOP
    DC.W    $60FF               ; BRA.S with displacement $FF: target odd (68000)
C3  JSR     DMP_CLOSE
    SIMHALT
ODD DC.W    $4E71,$4E71
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