*-----------------------------------------------------------
* Title      : exc - one exception per run
* Written by : easy68k-mac project (test fixture, GPL-2.0-or-later)
* Description: The test puts a case number in D7 and runs.  Case n is the
*              code at $2000 + n*$40.  With exceptions disabled the
*              simulator halts with a message; with exceptions enabled
*              the vector's stub records which vector was taken and the
*              top 16 bytes of the supervisor stack in RESULTS:
*                RESULTS+0   word  vector address that was taken
*                RESULTS+2   long  supervisor stack pointer in the handler
*                RESULTS+6   16 bytes copied from that stack
*              test/exceptions.test.mjs asserts messages and frames.
*-----------------------------------------------------------
VEC     MACRO                   stub for the vector at address \1
V\1     MOVE.W  #$\1,RESULTS
        BRA     COMMON
        ENDM

        ORG     $1000
START:  MOVEA.L #$00008000,A7
        MOVE.L  #V08,$08
        MOVE.L  #V0C,$0C
        MOVE.L  #V10,$10
        MOVE.L  #V14,$14
        MOVE.L  #V18,$18
        MOVE.L  #V1C,$1C
        MOVE.L  #V20,$20
        MOVE.L  #V24,$24
        MOVE.L  #V28,$28
        MOVE.L  #V2C,$2C
        MOVE.L  #V84,$84        TRAP #1
        MOVE.L  #VBC,$BC        TRAP #15
        MOVE.L  #0,$90          TRAP #4: a vector that is zero
*                               TRAP #2 ($88) is left uninitialised ($FFFFFFFF)
        LSL.W   #6,D7
        LEA     $2000,A0
        JMP     0(A0,D7.W)

        VEC     08
        VEC     0C
        VEC     10
        VEC     14
        VEC     18
        VEC     1C
        VEC     20
        VEC     24
        VEC     28
        VEC     2C
        VEC     84
        VEC     BC
COMMON  MOVE.L  A7,RESULTS+2
        LEA     RESULTS+6,A1
        MOVEA.L A7,A2
        MOVEQ   #7,D1
CPY     MOVE.W  (A2)+,(A1)+
        DBRA    D1,CPY
        SIMHALT

        ORG     $2000           case 0: ILLEGAL
        ILLEGAL
        ORG     $2040           case 1: privileged instruction in user mode
        ANDI    #$DFFF,SR
        MOVE    #$2700,SR
        ORG     $2080           case 2: CHK out of bounds
        MOVEQ   #20,D0
        CHK     #10,D0
        ORG     $20C0           case 3: STOP
        STOP    #$2000
        NOP
        ORG     $2100           case 4: TRAP #1
        TRAP    #1
        ORG     $2140           case 5: TRAPV with V set
        MOVE    #$02,CCR
        TRAPV
        ORG     $2180           case 6: divide by zero
        MOVEQ   #1,D0
        DIVU    #0,D0
        ORG     $21C0           case 7: address error on a read
        MOVE.W  $3001,D0
        ORG     $2200           case 8: address error on a write (odd stack pointer)
        MOVEA.L #$00007001,A7
        BSR     C8SUB
C8SUB   NOP
        ORG     $2240           case 9: read inside an Invalid range (bus error)
        MOVE.B  $5000,D0
        ORG     $2280           case 10: trace bit
        ORI     #$8000,SR
        NOP
        NOP
        ORG     $22C0           case 11: line A
        DC.W    $A123
        ORG     $2300           case 12: line F that is not SIMHALT
        DC.W    $F123,$0000
        ORG     $2340           case 13: TRAP #15 with a task number nobody serves
        MOVEQ   #26,D0
        TRAP    #15
        ORG     $2380           case 14: an opcode no table entry matches
        DC.W    $4E7F
        ORG     $23C0           case 15: RTS with nothing on the stack
        MOVEA.L #$01000000,A7
        RTS
        ORG     $2400           case 16: write into a Read-only range
        MOVEQ   #$55,D0
        MOVE.B  D0,$6000
        NOP
        ORG     $2440           case 17: write into a ROM range is ignored
        MOVE.B  #$55,$7000
        MOVE.B  $7000,D1
        SIMHALT
        ORG     $2480           case 18: TRAP #2, vector never written
        TRAP    #2
        ORG     $24C0           case 19: TRAP #4, vector is zero
        TRAP    #4
        ORG     $2500           case 20: exception with an odd supervisor stack pointer
        MOVEA.L #$00007001,A7
        TRAP    #1
        NOP
        ORG     $2540           case 21: SIMHALT bytes (the test turns SIMHALT off)
        SIMHALT
        ORG     $2580           case 22: privileged ANDI to SR in user mode
        ANDI    #$DFFF,SR
        ANDI    #$FFFF,SR
        ORG     $25C0           case 23: JMP to an odd address
        DC.W    $4EF9,$0000,$3001
        ORG     $2600           case 24: ADDI.W #imm with destination mode #imm (illegal)
        DC.W    $067C,$1234,$5678
        ORG     $2640           case 25: STOP in user mode
        ANDI    #$DFFF,SR
        STOP    #$2000
        ORG     $2680           case 26: STOP that loads an SR without the S bit
        STOP    #$0000
        ORG     $26C0           case 27: TRAP #2 with the address-error vector uninitialised too
        MOVE.L  #$FFFFFFFF,$0C
        TRAP    #2

        ORG     $4000
RESULTS DS.B    32

        END     START
