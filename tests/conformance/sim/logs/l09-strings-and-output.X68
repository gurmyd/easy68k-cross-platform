* @item sim-core 8 / sim-ui 13: execution log with the output log: copy and
* @item compare strings, print them with tasks 13, 14, 1 and 6
* @recipe log:2+out
    ORG     $1000
START:
    LEA     SRC,A0
    LEA     DST,A1
COPY:
    MOVE.B  (A0)+,(A1)+
    BNE     COPY
    LEA     SRC,A0
    LEA     DST,A1
CMPL:
    CMPM.B  (A0)+,(A1)+
    BNE     DIFF
    TST.B   -1(A0)
    BNE     CMPL
    MOVEQ   #1,D7
DIFF:
    LEA     DST,A1
    MOVEQ   #13,D0
    TRAP    #15
    LEA     SRC,A1
    MOVEQ   #5,D1
    MOVEQ   #1,D0
    TRAP    #15
    MOVEQ   #'!',D1
    MOVEQ   #6,D0
    TRAP    #15
    LEA     EOL,A1
    MOVEQ   #14,D0
    TRAP    #15
    SIMHALT
SRC DC.B    'Copied by the official simulator',0
EOL DC.B    13,10,0
DST DS.B    40
    END     START