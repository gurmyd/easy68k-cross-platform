* @item sim-core 3.9 privilege violation in user mode: MOVE to SR, ANDI to SR
* @item (stacked PC at the immediate word), MOVE USP, RESET, RTE, STOP (stacked
* @item PC opcode + 4: quirk); vector $20, class 1
* @switches /e
    ORG     $1000
START:
    MOVE.L  #PRIV,$20
    JSR     DMP_OPEN
    MOVE.L  #USTACK,A0
    MOVE.L  A0,USP
    LEA     CASES,A5
NEXT:
    MOVE.L  (A5)+,D7
    BEQ     DONE
    MOVE.L  D7,CONT
    MOVE    #$0000,SR           ; user mode
    MOVEA.L D7,A6
    SUBQ.L  #4,A6               ; each case is a 4-byte slot before its label
    JMP     (A6)
CASE1:
    MOVE    #$2700,SR
    NOP
U1  ANDI    #$2000,SR
U2  MOVE    USP,A1
    NOP
U3  RESET
    NOP
U4  RTE
    NOP
U5  STOP    #$2000
U6  NOP
DONE:
    JSR     DMP_CLOSE
    SIMHALT
* back in supervisor mode: write what was seen, continue with the next case
PRIV:
    JSR     DMP_REGS
    MOVEM.L D0/A0,-(SP)
    LEA     8(SP),A0
    MOVEQ   #6,D0
    JSR     DMP_MEM
    MOVEM.L (SP)+,D0/A0
    ADDQ.L  #6,SP
    MOVE    #$2000,SR
    BRA     NEXT
CASES DC.L  U1,U2,U3,U4,U5,U6,0
    DS.L    16
USTACK DS.L 1
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