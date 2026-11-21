* @item hardware 13 item 19: task 32/6 with D2 = 0 followed by D2 = $81 checks
* @item the box but gives no interrupts until the next Run (counted during a
* @item 300 ms delay); with exceptions on
* @switches /e
    ORG     $1000
START:
    MOVE.L  #IRQ1,$64
    JSR     DMP_OPEN
    MOVEQ   #0,D2
    MOVEQ   #6,D1
    MOVEQ   #32,D0
    TRAP    #15
    MOVE.B  #$81,D2
    MOVE.L  #10,D3
    TRAP    #15
    MOVEQ   #30,D1
    MOVEQ   #23,D0
    TRAP    #15
    MOVE.L  COUNT,D1
    LEA     CNT,A1
    JSR     DMP_VAL
    JSR     DMP_CLOSE
    SIMHALT
IRQ1:
    ADDQ.L  #1,COUNT
    RTE
COUNT DC.L  0
CNT   DC.B  'interrupts',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START