* @item sim-core 3.16 / 8: execution log of MOVEM pushes and pops in a loop,
* @item with LINK and UNLK frames
* @recipe log:2
    ORG     $1000
START:
    MOVEQ   #1,D0
    MOVEQ   #2,D1
    MOVEQ   #3,D2
    MOVEA.L #$4000,A2
    MOVE.W  #199,D7
LOOP:
    LINK    A6,#-8
    MOVEM.L D0-D2/A2,-(SP)
    ADDQ.L  #1,D0
    ROL.L   #1,D1
    MOVEM.L (SP)+,D3-D5/A3
    UNLK    A6
    ADD.L   D3,D2
    DBRA    D7,LOOP
    SIMHALT
    END     START