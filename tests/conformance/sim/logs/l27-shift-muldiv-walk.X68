* @item sim-core 3.16 / 8: a long execution log with registers (about 20,000
* @item instructions): the shift and rotate group (ASL, ASR, LSL, LSR, ROL, ROR,
* @item ROXL, ROXR with counts 0-63 from a register and as immediates, and on
* @item memory) and MULU, MULS, DIVU, DIVS (overflow included), EXT and SWAP;
* @item the operands and counts come from a 32-bit xorshift generator
* @recipe log:2
* @timeout 4800
    ORG     $1000
START:
    MOVE.L  #$9E3779B9,D7       ; generator state
    LEA     BUF,A0
    MOVE.W  #379,D6             ; 380 rounds
LOOP:
* xorshift32
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
* counts from a register
    MOVE.W  D7,D1
    ANDI.W  #63,D1
    MOVE.L  D7,D0
    ASL.L   D1,D0
    MOVE.L  D7,D0
    ASR.W   D1,D0
    LSR.B   D1,D0
    ROL.L   D1,D0
    ROR.W   D1,D0
    ROXL.B  D1,D0
    ROXR.L  D1,D0
    LSL.W   D1,D0
* immediate counts
    MOVE.L  D7,D2
    ASL.B   #1,D2
    ASR.L   #7,D2
    ROXL.W  #3,D2
    ROL.B   #8,D2
* memory (one bit, word)
    MOVE.L  D7,(A0)
    ASL     (A0)
    ROXR    2(A0)
    LSR     (A0)
    ROL     2(A0)
* multiply and divide
    MOVE.L  D7,D3
    SWAP    D3
    MULU    D7,D3
    MOVE.L  D7,D4
    MULS    D0,D4
    MOVE.W  D7,D5
    ORI.W   #1,D5
    DIVU    D5,D3
    DIVS    D5,D4
    MOVE.W  D2,D5
    EXT.L   D5
    EXT.W   D2
    ORI.B   #3,D5
    DIVS    D5,D0
    DBRA    D6,LOOP
    SIMHALT
BUF DS.L    2
    END     START
