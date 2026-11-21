* @item hardware 13 item 13: with mask 3 an auto interrupt of level 2 is held
* @item pending (a 50 ms delay lets it be requested) and taken right after the
* @item instruction that lowers the mask below 2 (stacked PC: the next one)
* @switches /e
    ORG     $1000
START:
    MOVE.L  #IRQ2,$68
    JSR     DMP_OPEN
    MOVE    #$2300,SR
    MOVE.B  #$82,D2
    MOVE.L  #10,D3
    MOVEQ   #6,D1
    MOVEQ   #32,D0
    TRAP    #15
    MOVEQ   #5,D1
    MOVEQ   #23,D0
    TRAP    #15
    MOVE.L  COUNT,D5            ; nothing taken yet
    MOVE    #$2100,SR
AFTER:
    NOP
    MOVE    #$2700,SR
    MOVE.L  STACKED,D1
    LEA     PCT,A1
    JSR     DMP_VAL
    LEA     AFTER,A0
    MOVE.L  A0,D1
    LEA     AFTERT,A1
    JSR     DMP_VAL
    MOVE.L  D5,D1
    LEA     BEFORE,A1
    JSR     DMP_VAL
    MOVE.W  INSR,D1
    LEA     SRT,A1
    JSR     DMP_VAL
    JSR     DMP_CLOSE
    SIMHALT
IRQ2:
    ADDQ.L  #1,COUNT
    TST.L   STACKED
    BNE     IRQX
    MOVE.L  2(SP),STACKED
    MOVE.W  SR,INSR
IRQX:
    MOVEM.L D0-D3,-(SP)
    MOVEQ   #0,D2
    MOVEQ   #6,D1
    MOVEQ   #32,D0
    TRAP    #15
    MOVEM.L (SP)+,D0-D3
    RTE
COUNT   DC.L 0
STACKED DC.L 0
INSR    DC.W 0
PCT     DC.B 'stackedPC',0
AFTERT  DC.B 'after',0
BEFORE  DC.B 'takenBefore',0
SRT     DC.B 'handlerSR',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START