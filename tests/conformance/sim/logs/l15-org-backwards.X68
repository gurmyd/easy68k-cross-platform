* @item sim-ui 19 Q25: a listing whose addresses do not ascend (ORG backwards):
* @item the execution-log lookup is a binary search over the listing text
* @recipe log:2
    ORG     $3000
PART2:
    MOVEQ   #2,D1
    ADDQ.L  #1,D1
    BRA     PART3
    ORG     $1000
START:
    MOVEQ   #1,D0
    BRA     PART2
    ORG     $2000
PART3:
    MOVEQ   #3,D2
    SUBQ.L  #1,D2
    SIMHALT
    END     START