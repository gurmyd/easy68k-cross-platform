* @item hardware 13 item 14: two pending levels (auto interrupts 1 and 3, held
* @item at mask 7 for a delay) are serviced highest first; the lower one is taken
* @item when the mask allows (after the RTE of the first)
* @switches /e
    ORG     $1000
START:
    MOVE.L  #IRQ1,$64
    MOVE.L  #IRQ3,$6C
    JSR     DMP_OPEN
    MOVE    #$2700,SR
    MOVE.B  #$81,D2
    MOVE.L  #10,D3
    MOVEQ   #6,D1
    MOVEQ   #32,D0
    TRAP    #15
    MOVE.B  #$83,D2
    TRAP    #15
    MOVEQ   #5,D1
    MOVEQ   #23,D0
    TRAP    #15
    MOVEQ   #0,D2
    MOVEQ   #6,D1
    MOVEQ   #32,D0
    TRAP    #15                 ; timers off; both requests are latched
    MOVE    #$2000,SR
    NOP
    NOP
    LEA     ORDER,A0
    MOVEQ   #4,D0
    JSR     DMP_MEM
    JSR     DMP_CLOSE
    SIMHALT
IRQ1:
    MOVEA.L PTR,A6
    MOVE.B  #1,(A6)+
    MOVE.L  A6,PTR
    RTE
IRQ3:
    MOVEA.L PTR,A6
    MOVE.B  #3,(A6)+
    MOVE.L  A6,PTR
    RTE
PTR   DC.L  ORDER
ORDER DC.B  0,0,0,0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START