* @item STDIO-MODEL.md section 8: the output log, while it runs, takes an entry of the
* @item run-time's stream table: with Log Start (output log) before Run, 46 streams whose
* @item close failed can be opened, not 47; the program prints the count and the result of the
* @item next open (task 3)
* @recipe outlog
* @owner engine
    ORG     $1000
START:
    MOVEQ   #0,D7
LOOP:
    LEA     NAME,A1
    MOVEQ   #52,D0
    TRAP    #15
    TST.W   D0
    BNE.S   FULL
    MOVE.L  D1,D6
    LEA     DATA,A1
    MOVEQ   #5,D2
    MOVEQ   #54,D0
    TRAP    #15
    MOVE.L  D6,D1
    LEA     BUF,A1
    MOVEQ   #7,D2
    MOVEQ   #53,D0
    TRAP    #15
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
    ADDQ.L  #1,D7
    ADDQ.B  #1,NAME+2
    CMP.B   #'9'+1,NAME+2
    BNE.S   NEXT
    MOVE.B  #'0',NAME+2
    ADDQ.B  #1,NAME+1
NEXT:
    CMP.W   #60,D7
    BNE     LOOP
FULL:
    MOVE.L  D0,D5
    MOVE.L  D7,D1
    MOVEQ   #3,D0
    TRAP    #15
    LEA     SEP,A1
    MOVEQ   #14,D0
    TRAP    #15
    MOVE.W  D5,D1
    EXT.L   D1
    MOVEQ   #3,D0
    TRAP    #15
    SIMHALT
NAME    DC.B    'x00.bin',0
SEP     DC.B    ' streams, then D0.W = ',0
DATA    DC.B    'ABCDE'
    DS.W    0
BUF     DS.B    16
    END     START
