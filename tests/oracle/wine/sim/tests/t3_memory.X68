*-----------------------------------------------------------
* t3_memory: addressing modes, MOVEM, MOVEP, stack, memory dump.
*-----------------------------------------------------------
    ORG     $1000
START:
    LEA     DUMPNAME,A1
    JSR     DMP_OPEN

    LEA     AREA,A0
    MOVE.L  #$11223344,(A0)+
    MOVE.W  #$5566,(A0)+
    MOVE.B  #$77,(A0)+
    MOVE.B  #$88,(A0)
    LEA     AREA+16,A2
    MOVEQ   #3,D0
FILL:
    MOVE.B  D0,-(A2)
    DBRA    D0,FILL
    LEA     AREA,A3
    MOVE.W  2(A3),D1
    MOVEQ   #4,D2
    MOVE.L  0(A3,D2.W),D3
    MOVEM.L D1-D3,AREA+20
    MOVE.L  #$AABBCCDD,D4
    LEA     AREA+40,A4
    MOVEP.L D4,0(A4)
    PEA     $DEAD
    MOVE.L  (SP)+,D5
    SWAP    D5
    EXG     D5,A5
    JSR     DMP_REGS

    LEA     AREA,A0
    MOVE.L  #64,D0
    JSR     DMP_MEM

    JSR     DMP_CLOSE
    SIMHALT

DUMPNAME DC.B   't3_memory_dump.txt',0
    DS.W    0
AREA     DS.B   64
    INCLUDE 'dumplib.X68'
    END     START
