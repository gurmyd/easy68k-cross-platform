* @item trap15-a 13 / 1.1: TRAP #15 with an unassigned task (26, 99) and
* @item exceptions enabled: the TRAP #15 exception through vector $BC (frame
* @item and registers as the handler sees them)
* @switches /e
    ORG     $1000
START:
    MOVE.L  #HANDLER,$BC
    JSR     DMP_OPEN
    MOVEQ   #26,D0
    TRAP    #15
    MOVEQ   #99,D0
    TRAP    #15
    MOVEQ   #0,D0
    MOVE.B  #$6F,D0
    TRAP    #15
    MOVE.L  COUNT,D1
    LEA     CNT,A1
    JSR     DMP_VAL
    JSR     DMP_CLOSE
    SIMHALT
HANDLER:
    ADDQ.L  #1,COUNT
    JSR     DMP_REGS
    MOVE.L  2(SP),D1
    LEA     PCTXT,A1
    JSR     DMP_VAL
    MOVE.W  (SP),D1
    LEA     SRTXT,A1
    JSR     DMP_VAL
    RTE
COUNT DC.L  0
CNT   DC.B  'count',0
PCTXT DC.B  'stackedPC',0
SRTXT DC.B  'stackedSR',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START