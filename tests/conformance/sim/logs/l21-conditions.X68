* @item sim-core 3.17 / 8: execution log of Scc and Bcc for all conditions under
* @item a sweep of condition codes
* @recipe log:2
    ORG     $1000
START:
    MOVEQ   #0,D7
LOOP:
    MOVE    D7,CCR
    SHI     D0
    SLS     D1
    SGE     D2
    SLT     D3
    SGT     D4
    SLE     D5
    BVS     V1
    NOP
V1  BMI     N1
    NOP
N1  ADDQ.B  #1,D7
    CMP.B   #32,D7
    BNE     LOOP
    SIMHALT
    END     START