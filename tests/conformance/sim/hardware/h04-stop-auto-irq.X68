* @item hardware 13 item 20 / sim-core 3.12: STOP #$2000 with exceptions on, an
* @item auto interrupt (task 32/6, level 1, 10 ms) resumes it; the instruction
* @item after STOP executes before the handler, so the stacked PC is that of the
* @item second instruction after STOP (quirk); SR in the handler: S = 1, mask 1
* @switches /e
    ORG     $1000
START:
    MOVE.L  #IRQ1,$64
    JSR     DMP_OPEN
    MOVE.B  #$81,D2
    MOVE.L  #10,D3
    MOVEQ   #6,D1
    MOVEQ   #32,D0
    TRAP    #15
    MOVEQ   #0,D7
    STOP    #$2000
FIRST:
    MOVEQ   #1,D7
SECOND:
    MOVEQ   #2,D6
    MOVE.L  STACKED,D1
    LEA     PCT,A1
    JSR     DMP_VAL
    LEA     FIRST,A0
    MOVE.L  A0,D1
    LEA     FIRSTT,A1
    JSR     DMP_VAL
    MOVE.W  INSR,D1
    LEA     SRT,A1
    JSR     DMP_VAL
    MOVE.L  D7,D1
    LEA     D7T,A1
    JSR     DMP_VAL
    JSR     DMP_CLOSE
    SIMHALT
IRQ1:
    MOVE.L  2(SP),STACKED
    MOVE.W  SR,INSR
    MOVEM.L D0-D3,-(SP)
    MOVEQ   #0,D2
    MOVEQ   #6,D1
    MOVEQ   #32,D0
    TRAP    #15                 ; all auto interrupts off
    MOVEM.L (SP)+,D0-D3
    RTE
STACKED DC.L 0
INSR    DC.W 0
PCT     DC.B 'stackedPC',0
FIRSTT  DC.B 'first',0
SRT     DC.B 'handlerSR',0
D7T     DC.B 'D7atStacked',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START