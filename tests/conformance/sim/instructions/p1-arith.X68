* @item sim-core 3.16 ADD/SUB/MULS/MULU/DIVS/DIVU/NEG and their flags (first proof of the report recipe, official-oracle 5.1)
* Moved from tests/oracle/wine/sim/tests/t1_arith.X68.
    ORG     $1000
START:
    JSR     DMP_OPEN

    MOVE.L  #$7FFFFFFF,D0
    ADDQ.L  #1,D0               ; overflow, negative
    JSR     DMP_REGS

    MOVE.B  #$80,D1
    SUB.B   #1,D1               ; overflow
    MOVE.W  #$FFFF,D2
    ADD.W   #1,D2               ; carry, zero, extend
    JSR     DMP_REGS

    MOVE.W  #-300,D3
    MULS    #200,D3
    MOVE.W  #$FFFF,D4
    MULU    #$FFFF,D4
    JSR     DMP_REGS

    MOVE.L  #100001,D5
    DIVU    #7,D5
    MOVE.L  #-100001,D6
    DIVS    #7,D6
    MOVE.L  #$12345678,D7
    DIVU    #2,D7               ; quotient overflow: V set, D7 unchanged
    JSR     DMP_REGS

    MOVEQ   #0,D0
    NEG.L   D0
    MOVE.L  #$80000000,D1
    NEG.L   D1
    MOVEQ   #5,D2
    NEGX.B  D2
    JSR     DMP_REGS

    JSR     DMP_CLOSE
    SIMHALT

    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START
