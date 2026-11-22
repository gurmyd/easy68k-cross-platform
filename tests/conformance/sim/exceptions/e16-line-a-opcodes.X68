* @item sim-core 3.16 entry 68 (LINE_1010) / 3.9: opcodes $A000, $A5A5, $AFFF,
* @item $A800 and $A001 executed with exceptions enabled, in supervisor and in user
* @item mode: vector $28, the frame (SR, stacked PC), the cycles, the registers;
* @item the opcode has no mnemonic, so it is written as DC.W and executed
* @switches /e
    ORG     $1000
START:
    MOVE.L  #H6,$28
    LEA     $00FF0000,A0
    MOVE.L  A0,USP
    MOVEA.L #0,A0
    JSR     DMP_OPEN
    MOVE.L  #C1,CONT
    JSR     DMP_CLRC
    DC.W    $A000
C1  MOVE.L  #C2,CONT
    MOVE.W  #$0015,CCR
    JSR     DMP_CLRC
    DC.W    $A5A5
C2  MOVE.L  #C3,CONT
    MOVE.L  #$11223344,D3
    JSR     DMP_CLRC
    DC.W    $AFFF
C3  MOVE.L  #C4,CONT
    ANDI.W  #$DFFF,SR           ; user mode
    DC.W    $A800
C4  MOVE.L  #C5,CONT
    DC.W    $A001               ; still in user mode
C5  JSR     DMP_CLOSE
    SIMHALT
    DS.W    0
* H6: registers, cycles, the 6-byte frame, then resume at CONT in supervisor
* mode for the first three and in user mode for the last two
H6:
    JSR     DMP_CYC
    JSR     DMP_REGS
    MOVEM.L D0/A0,-(SP)
    LEA     8(SP),A0
    MOVEQ   #6,D0
    JSR     DMP_MEM
    MOVEM.L (SP)+,D0/A0
    MOVE.L  CONT,2(SP)
    RTE
CONT DC.L   0
    INCLUDE '..\dumplib.X68'
    END     START
