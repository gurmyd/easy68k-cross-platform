* @item sim-core 3.16 BIT_FIELD / 8: execution log of bit-field instructions on
* @item a register and on memory (bit field enabled)
* @recipe log:2
* @switches /b
    ORG     $1000
START:
    MOVE.L  #$F0F0A5A5,D0
    LEA     DATA,A0
    MOVEQ   #0,D2
    MOVEQ   #19,D7
LOOP:
    BFEXTU  D0{D2:5},D1
    BFEXTS  (A0){D2:7},D3
    BFFFO   D0{D2:8},D4
    BFCHG   (A0){D2:3}
    BFINS   D1,D5{D2:4}
    ADDQ.L  #3,D2
    DBRA    D7,LOOP
    SIMHALT
DATA DC.L   $12345678,$9ABCDEF0,$0F1E2D3C
    END     START