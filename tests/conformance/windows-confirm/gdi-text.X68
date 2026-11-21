*-----------------------------------------------------------------------------
* gdi-text.X68 - text pixels and the pen as Windows' GDI makes them (trap15-b
* 15 V1, V2, V13; trap15-a 12 item 5). Run on real Windows with the default
* Output Window Font (Fixedsys 9): SIM68K.exe gdi-text.S68 /r. result.bin
* gets: the pen after task 95 for "W", "AB", "iii" and bytes 1-31 between two
* letters; the pixels (task 83) of the cells of "A" printed by task 14 on a
* red fill colour; the grid (task 22 stride, last row).
*-----------------------------------------------------------------------------
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     TEXTS,A3
TLOOP:
    TST.B   (A3)
    BEQ     TDONE
    MOVEQ   #0,D1
    MOVEQ   #0,D2
    MOVEQ   #86,D0
    TRAP    #15
    MOVEA.L A3,A1
    MOVE.W  #20,D1
    MOVE.W  #300,D2
    MOVEQ   #95,D0
    TRAP    #15
    MOVEQ   #96,D0
    TRAP    #15
    JSR     DMP_REGS
TNEXT:
    TST.B   (A3)+
    BNE     TNEXT
    BRA     TLOOP
TDONE:
    MOVE.L  #$000000FF,D1
    MOVEQ   #81,D0
    TRAP    #15
    LEA     A,A1
    MOVEQ   #14,D0
    TRAP    #15
    MOVEQ   #0,D6               ; y
YLOOP:
    MOVEQ   #0,D5               ; x
    MOVEQ   #0,D4               ; 16 pixels as bits
XLOOP:
    MOVE.W  D5,D1
    MOVE.W  D6,D2
    MOVEQ   #83,D0
    TRAP    #15
    LSL.L   #1,D4
    CMP.L   #$000000FF,D0
    BEQ     XBG
    ADDQ.L  #1,D4
XBG:
    ADDQ.W  #1,D5
    CMP.W   #16,D5
    BNE     XLOOP
    MOVE.L  D4,D1
    LEA     ROW,A1
    JSR     DMP_VAL
    ADDQ.W  #1,D6
    CMP.W   #20,D6
    BNE     YLOOP
    JSR     DMP_CLOSE
    SIMHALT
TEXTS DC.B  'W',0,'AB',0,'iii',0,'A',1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,'B',0,0
A     DC.B  'A',0
ROW   DC.B  'row',0
    DS.W    0
    INCLUDE '..\sim\dumplib.X68'
    END     START