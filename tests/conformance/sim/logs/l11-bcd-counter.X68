* @item sim-core 3.16 / 8: execution log (with the empty memory blocks of type 3)
* @item of a BCD counter from 0 to 400 with ABCD and the X bit
* @recipe log:3
    ORG     $1000
START:
    MOVEQ   #0,D0               ; low two digits
    MOVEQ   #0,D1               ; high two digits
    MOVEQ   #1,D2
    MOVEQ   #0,D3
    MOVE.W  #399,D7
LOOP:
    ANDI    #$EF,CCR            ; X = 0
    ABCD    D2,D0
    ABCD    D3,D1
    DBRA    D7,LOOP
    SIMHALT
    END     START