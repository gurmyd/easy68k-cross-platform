*-----------------------------------------------------------
* t2_bcd_shift: ABCD/SBCD/NBCD, shifts and rotates with flags.
*-----------------------------------------------------------
    ORG     $1000
START:
    LEA     DUMPNAME,A1
    JSR     DMP_OPEN

    MOVE.B  #$45,D0
    MOVE.B  #$38,D1
    ANDI    #$00,CCR
    ABCD    D1,D0               ; $83
    MOVE.B  #$99,D2
    MOVE.B  #$01,D3
    ABCD    D3,D2               ; $00, carry
    MOVE.B  #$10,D4
    MOVE.B  #$25,D5
    SBCD    D5,D4
    MOVE.B  #$42,D6
    NBCD    D6
    JSR     DMP_REGS

    MOVE.L  #$80000001,D0
    ASL.L   #1,D0
    MOVE.L  #$80000001,D1
    ASR.L   #4,D1
    MOVE.L  #$80000001,D2
    LSR.L   #1,D2
    MOVE.W  #$8001,D3
    ROL.W   #1,D3
    MOVE.W  #$8001,D4
    ROR.W   #2,D4
    JSR     DMP_REGS

    MOVE.B  #$81,D5
    ORI     #$10,CCR            ; X = 1
    ROXL.B  #1,D5
    MOVE.L  #$12345678,D6
    MOVEQ   #40,D7
    LSL.L   D7,D6               ; shift count 40 (mod 64) -> 0
    JSR     DMP_REGS

    JSR     DMP_CLOSE
    SIMHALT

DUMPNAME DC.B   't2_bcd_shift_dump.txt',0
    DS.W    0
    INCLUDE 'dumplib.X68'
    END     START
