* @item sim-core 3.16 LINK/UNLK quirk: A[reg] is used without a_reg(), so LINK A7
* @item in supervisor mode uses the user stack pointer as the frame register
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     USTACK,A0
    MOVE.L  A0,USP
    LINK    A7,#-8
    MOVE    USP,A1
    MOVEA.L SP,A2
    JSR     DMP_REGS
    UNLK    A7
    MOVE    USP,A3
    MOVEA.L SP,A4
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
    DS.L    8
USTACK DS.L 1
    INCLUDE '..\dumplib.X68'
    END     START