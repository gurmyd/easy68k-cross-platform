* @item sim-core 3.16 / 8: a long execution log with registers (about 20,000
* @item instructions): the integer arithmetic and logic group - ADD, ADDA, ADDI,
* @item ADDQ, ADDX, SUB, SUBA, SUBI, SUBQ, SUBX, NEG, NEGX, CMP, CMPA, CMPI, CMPM,
* @item AND, ANDI, OR, ORI, EOR, EORI, NOT, CLR, TST - in byte, word and long size
* @item over the data addressing modes (Dn, An, (An), (An)+, -(An), d16(An),
* @item d8(An,Xn), abs.L, d16(PC), #imm); the operands come from a 32-bit xorshift
* @item generator, so that every line of the log compares new values and flags
* @recipe log:2
* @timeout 4800
    ORG     $1000
START:
    MOVE.L  #$2545F491,D7       ; generator state
    LEA     BUF,A0
    MOVEA.L #$00012345,A1
    MOVE.W  #339,D6             ; 340 rounds
LOOP:
* xorshift32: x ^= x << 13; x ^= x >> 17; x ^= x << 5
    MOVE.L  D7,D0
    LSL.L   #8,D0
    LSL.L   #5,D0
    EOR.L   D0,D7
    MOVE.L  D7,D0
    CLR.W   D0
    SWAP    D0
    LSR.L   #1,D0
    EOR.L   D0,D7
    MOVE.L  D7,D0
    LSL.L   #5,D0
    EOR.L   D0,D7
* register operands
    MOVE.L  D7,D1
    MOVE.L  D7,D2
    SWAP    D2
    ADD.B   D1,D2
    ADDX.W  D1,D2
    SUB.L   D2,D1
    SUBX.B  D2,D1
    NEG.W   D2
    NEGX.L  D1
    CMP.W   D1,D2
    ADDA.W  D1,A1
    SUBA.L  D2,A1
    CMPA.L  A1,A0
    ADDQ.B  #3,D1
    SUBQ.L  #8,D2
    ADDI.W  #$7FFF,D1
    SUBI.B  #$80,D2
    CMPI.L  #$80000000,D1
    TST.W   D2
    ANDI.L  #$F0F0F0F0,D1
    ORI.W   #$0101,D2
    EORI.B  #$55,D1
* memory operands
    MOVE.L  D1,(A0)
    ADD.L   D2,(A0)
    AND.W   (A0),D1
    OR.B    1(A0),D2
    EOR.L   D7,(A0)
    NOT.B   3(A0)
    MOVE.W  D6,D3
    ANDI.W  #6,D3
    ADD.W   4(A0,D3.W),D2
    SUB.W   D1,4(A0,D3.W)
    MOVE.L  D7,8(A0)
    CMP.L   BUF+8,D7
    ADD.L   CONST(PC),D2
    LEA     BUF+16,A2
    LEA     BUF+8,A3
    ADDX.B  -(A2),-(A3)
    ADDX.B  -(A2),-(A3)
    SUBX.W  -(A2),-(A3)
    LEA     BUF,A2
    LEA     BUF+4,A3
    CMPM.W  (A2)+,(A3)+
    NEG.B   (A2)+
    CLR.B   (A3)
    TST.L   (A0)
    DBRA    D6,LOOP
    SIMHALT
CONST DC.L  $13579BDF
BUF DS.B    32
    END     START
