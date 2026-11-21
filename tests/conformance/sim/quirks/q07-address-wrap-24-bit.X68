* @item sim-core 1.5: addresses are taken modulo $1000000: a write through
* @item $01002000 lands at $002000; a long access at $FFFFFE wraps to $000000
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVEA.L #$01002000,A0
    MOVE.L  #$CAFEBABE,(A0)
    MOVE.L  $2000,D1
    MOVEA.L #$FFFFFE,A1
    MOVE.W  #$1234,(A1)
    MOVE.W  $FFFFFE,D2
    JSR     DMP_REGS
    LEA     $1FFC,A0
    MOVEQ   #8,D0
    JSR     DMP_MEM
    JSR     DMP_CLOSE
    SIMHALT
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START