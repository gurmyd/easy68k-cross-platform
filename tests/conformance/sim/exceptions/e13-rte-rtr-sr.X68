* @item sim-core 3.16 RTE loads all 16 SR bits and pops only the 6-byte frame;
* @item RTR keeps the system byte; MOVE to CCR writes bits 5-7 of the low byte
* @switches /e
    ORG     $1000
START:
    JSR     DMP_OPEN
    PEA     R1
    MOVE.W  #$27FF,-(SP)
    RTE
R1  JSR     DMP_REGS
    PEA     R2
    MOVE.W  #$00E0,-(SP)
    RTR
R2  JSR     DMP_REGS
    MOVE.W  #$00FF,D0
    MOVE    D0,CCR
    MOVE    SR,D1
    MOVE    #$2700,SR
    PEA     R3
    MOVE.W  #$2000,-(SP)
    RTE
R3  JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START