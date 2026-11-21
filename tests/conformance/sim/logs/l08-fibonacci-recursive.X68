* @item sim-core 8 execution log of a recursive Fibonacci (BSR, RTS, MOVEM to and
* @item from the stack, stack frames) for n = 11
* @recipe log:2
    ORG     $1000
START:
    MOVEQ   #11,D0
    BSR     FIB
    MOVE.L  D0,D7
    SIMHALT
* D0 = fib(D0)
FIB:
    CMP.L   #2,D0
    BLT     FIBX
    MOVEM.L D1-D2,-(SP)
    MOVE.L  D0,D1
    SUBQ.L  #1,D0
    BSR     FIB
    MOVE.L  D0,D2
    MOVE.L  D1,D0
    SUBQ.L  #2,D0
    BSR     FIB
    ADD.L   D2,D0
    MOVEM.L (SP)+,D1-D2
FIBX:
    RTS
    END     START