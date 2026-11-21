* @item sim-core 3.11 the trace bit (exceptions enabled): the instruction that
* @item sets T is not traced, the next ones are, each through vector $24 with the
* @item address of the next instruction; the instruction that clears T is traced
* @switches /e
    ORG     $1000
START:
    MOVE.L  #TRACE,$24
    JSR     DMP_OPEN
    MOVE    #$A000,SR
    MOVEQ   #1,D1
    MOVEQ   #2,D2
    MOVE    #$2000,SR
    MOVEQ   #3,D3
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
    RTE
COUNT DC.L  0
CNT   DC.B  'traces',0
PCT   DC.B  'stackedPC',0
SRT   DC.B  'stackedSR',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START