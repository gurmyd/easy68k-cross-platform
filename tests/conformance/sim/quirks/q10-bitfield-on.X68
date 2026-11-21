* @item sim-core 4 / official-oracle 5.3: with /b, BFEXTU D0{0:4},D1 on
* @item $A5000000 gives $0000000A
* @switches /b /e
    ORG     $1000
START:
    MOVE.L  #ILL,$10
    JSR     DMP_OPEN
    MOVE.L  #$A5000000,D0
    MOVEQ   #0,D1
    BFEXTU  D0{0:4},D1
    MOVE.L  #$600D600D,D6
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
ILL:
    MOVE.L  #$B4B4B4B4,D7
    ADDQ.L  #4,2(SP)
    RTE
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START