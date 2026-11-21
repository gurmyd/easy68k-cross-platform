* @item sim-core 3.16 LEA quirk: the result is 24-bit ($12345678 gives
* @item $00345678, -1(A0) with A0 = 0 gives $00FFFFFF); MOVEA is not masked;
* @item the stack pointer at reset ($01000000) seen by LEA 4(SP)
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     $12345678,A1
    SUBA.L  A0,A0
    LEA     -1(A0),A2
    MOVEA.L #$12345678,A3
    LEA     4(SP),A4
    MOVEA.L SP,A5
    LEA     $FFFF8000,A6
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START