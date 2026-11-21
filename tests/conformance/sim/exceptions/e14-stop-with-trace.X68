* @item sim-core 3.12 STOP with the T bit set returns TRACE_EXCEPTION: two trace
* @item frames (quirk); the stacked SRs and PCs are written
* @switches /e
    ORG     $1000
START:
    MOVE.L  #TRACE,$24
    JSR     DMP_OPEN
    MOVE    #$A000,SR
    STOP    #$2000
    NOP
    MOVE    #$2000,SR
    MOVE.L  COUNT,D1
    LEA     CNT,A1
    JSR     DMP_VAL
    JSR     DMP_CLOSE
    SIMHALT
TRACE:
    ADDQ.L  #1,COUNT
    MOVE.L  D1,-(SP)
    MOVE.L  6(SP),D1
    LEA     PCT,A1
    JSR     DMP_VAL
    MOVE.W  4(SP),D1
    LEA     SRT,A1
    JSR     DMP_VAL
    MOVE.L  (SP)+,D1
    ANDI.W  #$7FFF,(SP)
    RTE
COUNT DC.L  0
CNT   DC.B  'traces',0
PCT   DC.B  'stackedPC',0
SRT   DC.B  'stackedSR',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START