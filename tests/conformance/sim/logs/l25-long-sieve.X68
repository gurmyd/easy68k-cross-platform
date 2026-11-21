* @item sim-core 8: a long execution log (instruction only): the sieve of
* @item Eratosthenes up to 600 (byte flags, nested loops)
* @recipe log:1
* @timeout 2400
    ORG     $1000
START:
    LEA     FLAGS,A0
    MOVE.W  #599,D7
CLR:
    CLR.B   (A0)+
    DBRA    D7,CLR
    MOVEQ   #2,D1               ; candidate
    MOVEQ   #0,D5               ; primes found
NEXT:
    LEA     FLAGS,A0
    TST.B   0(A0,D1.W)
    BNE     SKIP
    ADDQ.W  #1,D5
    MOVE.W  D1,D2
    ADD.W   D1,D2
MARK:
    CMP.W   #600,D2
    BHS     SKIP
    ST      0(A0,D2.W)
    ADD.W   D1,D2
    BRA     MARK
SKIP:
    ADDQ.W  #1,D1
    CMP.W   #600,D1
    BLO     NEXT
    SIMHALT
FLAGS DS.B  600
    END     START