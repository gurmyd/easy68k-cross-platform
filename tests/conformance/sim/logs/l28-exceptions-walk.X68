* @item sim-core 3.9 / 8: a long execution log with registers (9,703
* @item instructions) through exceptions, exceptions enabled: TRAP #0, #5 and
* @item #14, CHK in and out of bounds, divide by zero, TRAPV with V set and
* @item clear, ILLEGAL, line A and line F, a privilege violation in user mode,
* @item and the switch between user and supervisor mode (US and SS in the log)
* @recipe log:2
* @switches /e
* @timeout 4800
    ORG     $1000
START:
    MOVE.L  #SKIP2,$10          ; illegal instruction
    MOVE.L  #COUNT,$14          ; divide by zero
    MOVE.L  #COUNT,$18          ; CHK
    MOVE.L  #COUNT,$1C          ; TRAPV
    MOVE.L  #PRIV,$20           ; privilege violation
    MOVE.L  #SKIP2,$28          ; line A
    MOVE.L  #SKIP2,$2C          ; line F
    LEA     $80,A0
    MOVEQ   #14,D0
VECS:
    MOVE.L  #COUNT,(A0)+        ; TRAP #0 to #14
    DBRA    D0,VECS
    MOVE.L  #SUPER,$84          ; TRAP #1 returns in supervisor mode
    LEA     $00FF0000,A0
    MOVE.L  A0,USP
    MOVE.L  #$6D2B79F5,D7       ; generator state
    MOVE.W  #179,D6             ; 180 rounds
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
* traps
    TRAP    #0
    TRAP    #5
    TRAP    #14
* CHK: D2 from -8 to 23 against 15
    MOVE.W  D7,D2
    ANDI.W  #31,D2
    SUBQ.W  #8,D2
    CHK     #15,D2
* divide: by zero when the low three bits are clear
    MOVE.W  D7,D3
    ANDI.W  #7,D3
    MOVE.L  D7,D4
    LSR.L   #8,D4
    DIVU    D3,D4
* TRAPV after an addition that may overflow
    MOVE.W  D7,D5
    ADD.W   #$4000,D5
    ADD.W   #$4000,D5
    TRAPV
    ILLEGAL
    DC.W    $A123
    DC.W    $F456
* user mode, a privileged instruction, back to supervisor mode
    ANDI.W  #$DFFF,SR
    MOVE.L  D7,-(SP)
    MOVE.W  #$2700,SR
    MOVE.L  (SP)+,D1
    TRAP    #1
    DBRA    D6,LOOP
    SIMHALT
COUNT:
    ADDQ.L  #1,A6
    RTE
SKIP2:
    ADDQ.L  #1,A5
    ADDQ.L  #2,2(SP)
    RTE
PRIV:
    ADDQ.L  #1,A4
    ADDQ.L  #4,2(SP)
    RTE
SUPER:
    ORI.W   #$2000,(SP)
    RTE
    END     START
