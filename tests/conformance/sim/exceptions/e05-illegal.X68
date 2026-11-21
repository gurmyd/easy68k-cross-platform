* @item sim-core 3.9 illegal instruction: ILLEGAL ($4AFC) and an unused opcode
* @item through vector $10, class 1, stacked PC = PC - 2 when the handler
* @item returned; ADDI with an illegal mode has already fetched its immediate
* @item (quirk: stacked PC past the opcode)
* @switches /e
    ORG     $1000
START:
    MOVE.L  #H6,$10
    JSR     DMP_OPEN
    MOVE.L  #C1,CONT
    JSR     DMP_CLRC
    ILLEGAL
C1  MOVE.L  #C2,CONT
    DC.W    $4E7B               ; MOVEC: not a 68000 instruction
C2  MOVE.L  #C3,CONT
    DC.W    $067C,$1234         ; ADDI.W #$1234 with mode 7/4 (immediate destination)
C3  MOVE.L  #C4,CONT
    DC.W    $0E40               ; MOVES: not on a 68000
C4  JSR     DMP_CLOSE
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