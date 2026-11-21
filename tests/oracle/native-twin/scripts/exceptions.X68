*-----------------------------------------------------------
* Title      : exceptions
* Written by : easy68k-mac (simulator twin test program)
* Description: exception processing with exceptions enabled:
*              TRAP, divide by zero, CHK, TRAPV, illegal, line A,
*              line F, privilege violation, the trace bit, an
*              address error and interrupts (exceptions.sim).
*              Part of easy68k-mac, GPL-2.0-or-later.
*-----------------------------------------------------------
        ORG     $0
        DC.L    $8000           initial SSP (not used by the simulator)
        DC.L    START
        DC.L    HANDLER         2 bus error
        DC.L    ADDRERR         3 address error
        DC.L    HANDLER         4 illegal
        DC.L    HANDLER         5 zero divide
        DC.L    HANDLER         6 CHK
        DC.L    HANDLER         7 TRAPV
        DC.L    HANDLER         8 privilege
        DC.L    TRACEH          9 trace
        DC.L    HANDLER         10 line A
        DC.L    HANDLER         11 line F
        DCB.L   13,HANDLER      12-24
        DC.L    IRQH,IRQH,IRQH,IRQH,IRQH,IRQH,IRQH   25-31 autovectors
        DCB.L   16,HANDLER      32-47 TRAP #0-#15

        ORG     $1000
START:
        LEA     $8000,SP
        MOVE.L  #0,D6           exception counter
        TRAP    #3
        MOVE.L  #10,D0
        MOVE.L  #0,D1
        DIVU    D1,D0           divide by zero
        MOVE.W  #-1,D2
        CHK     #5,D2           CHK
        MOVE.L  #$7FFFFFFF,D3
        ADDQ.L  #1,D3
        TRAPV
        DC.W    $4AFC           ILLEGAL
        DC.W    $A123           line A
        DC.W    $F123           line F (not SIMHALT)
        ORI.W   #$8000,SR       trace on
        NOP
        NOP
        ANDI.W  #$7FFF,SR       trace off (this one is traced)
        MOVE.W  #$0000,SR       user mode
        MOVE.W  #$2000,SR       privilege violation
        MOVE.W  #$2000,SR       (again, from the handler's return)
        MOVE.L  #$1001,A0
        MOVE.W  (A0),D4         address error: the handler skips it
AFTER:  MOVE.W  #$2000,SR
        ANDI.W  #$F8FF,SR       unmask interrupts
LOOP:   ADDQ.L  #1,D5
        CMP.L   #200,D5
        BNE     LOOP
        SIMHALT

HANDLER:
        ADDQ.L  #1,D6
        RTE
TRACEH:
        ADDQ.L  #1,D7
        RTE
IRQH:
        ADD.L   #$100,D6
        RTE
ADDRERR:
        ADDQ.L  #1,D6
        ADDQ.L  #8,SP           drop info word, access address, instruction register
        MOVE.L  #AFTER,2(SP)    resume after the faulting instruction
        RTE
        END     START
