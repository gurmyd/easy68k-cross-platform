* @item sim-core 3.9 / hardware 13 items 31, 32: bus errors from the memory map:
* @item a write into a Read range, a read in an Invalid range, a long read
* @item starting 2 bytes below the Invalid range (no error) and a long write
* @item starting there (error)
* @switches /e
    MEMORY  READ $6000,$60FF
    MEMORY  INVALID $7000,$70FF
    ORG     $1000
START:
    MOVE.L  #H14,$8
    JSR     DMP_OPEN
    MOVE.L  #C1,CONT
    JSR     DMP_CLRC
    MOVE.W  #1,$6010
C1  MOVE.L  #C2,CONT
    MOVE.W  $6010,D1
    JSR     DMP_REGS
    MOVE.W  $7010,D2
C2  MOVE.L  #C3,CONT
    MOVE.L  $6FFE,D3
    JSR     DMP_REGS
    MOVE.L  D3,$6FFE
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