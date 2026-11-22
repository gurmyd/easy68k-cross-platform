* @item trap15-a tasks 1, 3, 6, 13, 14, 15, 17, 20 / sim-ui 13: a long
* @item execution log with registers and the output log (about 13,000
* @item instructions): a table of numbers printed in decimal, in a field, in
* @item radix 2 to 36 and as hexadecimal text made by the program, one row a line
* @recipe log:2+out
* @timeout 4800
    ORG     $1000
START:
    MOVE.L  #$1F123BB5,D7       ; generator state
    MOVEQ   #2,D6               ; radix of the row
    MOVE.W  #149,D5             ; 150 rows
ROW:
* xorshift32
    MOVE.L  D7,D0
    LSL.L   #8,D0
    LSL.L   #5,D0
    EOR.L   D0,D7
    MOVE.L  D7,D0
    CLR.W   D0
    SWAP    D0
    LSR.L   #1,D0
    EOR.L   D0,D7
    MOVE.L  D7,D0
    LSL.L   #5,D0
    EOR.L   D0,D7
* the value of the row: a signed word
    MOVE.W  D7,D1
    EXT.L   D1
    MOVE.L  D1,D4
* task 3: decimal
    MOVEQ   #3,D0
    TRAP    #15
    MOVEQ   #' ',D1
    MOVEQ   #6,D0
    TRAP    #15
* task 20: in a field of 8
    MOVE.L  D4,D1
    MOVEQ   #8,D2
    MOVEQ   #20,D0
    TRAP    #15
* task 15: the low word in the row's radix
    MOVEQ   #' ',D1
    MOVEQ   #6,D0
    TRAP    #15
    MOVE.L  D4,D1
    ANDI.L  #$FFFF,D1
    MOVE.B  D6,D2
    MOVEQ   #15,D0
    TRAP    #15
* the program's own hexadecimal text of D7, through task 14
    LEA     HEX,A1
    MOVE.B  #' ',(A1)+
    MOVE.L  D7,D3
    MOVEQ   #7,D2
DIGIT:
    ROL.L   #4,D3
    MOVE.B  D3,D0
    ANDI.W  #$F,D0
    MOVE.B  DIGITS(PC,D0.W),(A1)+
    DBRA    D2,DIGIT
    CLR.B   (A1)
    LEA     HEX,A1
    MOVEQ   #14,D0
    TRAP    #15
* task 17: a label with the unsigned byte; task 13 ends the row
    LEA     LABEL,A1
    MOVEQ   #0,D1
    MOVE.B  D7,D1
    MOVEQ   #17,D0
    TRAP    #15
    LEA     EMPTY,A1
    MOVEQ   #13,D0
    TRAP    #15
* the next radix: 2 to 36
    ADDQ.B  #1,D6
    CMPI.B  #37,D6
    BNE     NEXT
    MOVEQ   #2,D6
NEXT:
    DBRA    D5,ROW
    LEA     DONE,A1
    MOVEQ   #4,D1
    MOVEQ   #1,D0
    TRAP    #15
    SIMHALT
DIGITS DC.B '0123456789ABCDEF'
LABEL DC.B  ' b=',0
EMPTY DC.B  0
DONE DC.B   'done'
HEX DS.B    12
    END     START
