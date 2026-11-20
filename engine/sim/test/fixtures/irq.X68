*-----------------------------------------------------------
* Title      : irq - interrupts, the interrupt mask, STOP, the Reset button
* Written by : easy68k-mac project (test fixture, GPL-2.0-or-later)
* Description: The test puts a case number in D7, enables exceptions and
*              requests interrupts while the program runs.  Each level's
*              handler counts in COUNTS+level and logs its level and the
*              stacked SR and PC.  test/interrupts.test.mjs asserts.
*-----------------------------------------------------------
        ORG     $1000
START:  MOVEA.L #$00008000,A7
        LEA     LOG,A6
        MOVE.L  #IRQ1,$64
        MOVE.L  #IRQ2,$68
        MOVE.L  #IRQ3,$6C
        MOVE.L  #IRQ4,$70
        MOVE.L  #IRQ5,$74
        MOVE.L  #IRQ6,$78
        MOVE.L  #IRQ7,$7C
        MOVE.L  #$00009000,$00  reset vector: SSP
        MOVE.L  #RESET,$04      reset vector: PC
        LSL.W   #6,D7
        LEA     $2000,A0
        JMP     0(A0,D7.W)

IRQ1    MOVEQ   #1,D6
        BRA.S   IRQC
IRQ2    MOVEQ   #2,D6
        BRA.S   IRQC
IRQ3    MOVEQ   #3,D6
        BRA.S   IRQC
IRQ4    MOVEQ   #4,D6
        BRA.S   IRQC
IRQ5    MOVEQ   #5,D6
        BRA.S   IRQC
IRQ6    MOVEQ   #6,D6
        BRA.S   IRQC
IRQ7    MOVEQ   #7,D6
IRQC    LEA     COUNTS,A1
        ADDQ.B  #1,0(A1,D6.W)   count this level
        MOVE.W  D6,(A6)+        log: level
        MOVE    SR,(A6)+        log: SR inside the handler
        MOVE.W  (A7),(A6)+      log: stacked SR
        MOVE.L  2(A7),(A6)+     log: stacked PC
        RTE

RESET   MOVE.W  #$5E5E,RESETMK  reached through the Reset button
        MOVE.L  A7,RESETSP
        SIMHALT

        ORG     $2000           case 0: mask 0, spin until D5 becomes non-zero
        MOVE    #$2000,SR
SPIN0   ADDQ.L  #1,D4
        TST.L   D5
        BEQ.S   SPIN0
        SIMHALT
        ORG     $2040           case 1: mask 3, spin
        MOVE    #$2300,SR
SPIN1   ADDQ.L  #1,D4
        TST.L   D5
        BEQ.S   SPIN1
        SIMHALT
        ORG     $2080           case 2: STOP with mask 0, then count and halt
        STOP    #$2000
        ADDQ.L  #1,D3           first instruction after STOP
        ADDQ.L  #1,D3           second instruction after STOP
        SIMHALT
        ORG     $20C0           case 3: STOP with mask 5 (levels 1-5 cannot wake it)
        STOP    #$2500
        ADDQ.L  #1,D3
        ADDQ.L  #1,D3
        SIMHALT
        ORG     $2100           case 4: auto interrupt, TRAP #15 task 32 (case 5 is not used)
        MOVE    #$2000,SR
        MOVEQ   #32,D0
        MOVEQ   #5,D1           enable exceptions
        TRAP    #15
        MOVEQ   #32,D0
        MOVEQ   #6,D1
        MOVE.B  #$82,D2         enable auto IRQ 2 ...
        MOVE.L  #100,D3         ... every 100 ms
        TRAP    #15
WAIT4   CMPI.B  #3,COUNTS+2     until three interrupts were taken
        BLT.S   WAIT4
        MOVEQ   #32,D0
        MOVEQ   #6,D1
        MOVEQ   #0,D2           disable all auto IRQs
        TRAP    #15
        SIMHALT
        ORG     $2180           case 6: mask 7 (only level 7 gets through), spin
        MOVE    #$2700,SR
SPIN5   ADDQ.L  #1,D4
        TST.L   D5
        BEQ.S   SPIN5
        SIMHALT
        ORG     $21C0           case 7: an interrupt and a TRAP #1 in the same step
        MOVE.L  #TRAP1,$84
        MOVE    #$2000,SR
        NOP
        TRAP    #1
        NOP
        SIMHALT
TRAP1   MOVE.W  #$7A7A,(A6)+    log marker
        MOVE.W  (A7),(A6)+      stacked SR
        MOVE.L  2(A7),(A6)+     stacked PC
        SIMHALT

        ORG     $3000
COUNTS  DC.B    0,0,0,0,0,0,0,0
RESETMK DC.W    0
RESETSP DC.L    0

        ORG     $4000
LOG     DS.B    256

        END     START
