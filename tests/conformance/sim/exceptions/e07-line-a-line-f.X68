* @item sim-core 3.9 line A ($A000) and line F ($F000, $FFFE): vectors $28 and
* @item $2C, stacked PC = opcode + 2 (quirk: a real 68000 stacks the opcode)
* @switches /e
    ORG     $1000
START:
    MOVE.L  #H6,$28
    MOVE.L  #H6,$2C
    JSR     DMP_OPEN
    MOVE.L  #C1,CONT
    JSR     DMP_CLRC
    DC.W    $A123
C1  MOVE.L  #C2,CONT
    DC.W    $F000
C2  MOVE.L  #C3,CONT
    DC.W    $FFFF,$FFFE         ; not SIMHALT: the second word is not $FFFF
C3  JSR     DMP_CLOSE
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