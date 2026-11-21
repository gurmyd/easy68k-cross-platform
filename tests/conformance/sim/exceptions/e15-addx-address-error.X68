* @item sim-core 3.16 ADDX -(Ay),-(Ax) with an odd Ax: only a bus error is
* @item handled; an address error falls through into the write and a second
* @item read, giving up to three frames (each handler entry is written)
* @switches /e
    ORG     $1000
START:
    MOVE.L  #AE,$C
    JSR     DMP_OPEN
    LEA     DATA+5,A0
    LEA     DATA+8,A1
    MOVE.L  #C1,CONT
    ADDX.W  -(A1),-(A0)
C1  MOVE.L  COUNT,D1
    LEA     CNT,A1
    JSR     DMP_VAL
    JSR     DMP_CLOSE
    SIMHALT
AE:
    ADDQ.L  #1,COUNT
    JSR     DMP_REGS
    MOVEM.L D0/A0,-(SP)
    LEA     8(SP),A0
    MOVEQ   #42,D0              ; room for three 14-byte frames
    JSR     DMP_MEM
    MOVEM.L (SP)+,D0/A0
    MOVEA.L #$01000000,SP       ; the stack of the main program, empty
    MOVEA.L CONT,A0
    JMP     (A0)
COUNT DC.L  0
CNT   DC.B  'frames',0
    DS.W    0
DATA DC.L   $11223344,$55667788,$99AABBCC
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