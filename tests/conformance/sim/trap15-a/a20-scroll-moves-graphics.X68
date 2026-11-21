* @item trap15-a 13 Text output: a graphics line across the screen moves up one
* @item text row when a LF on the last row scrolls (the column of pixels at
* @item x = 300 is scanned before and after: the rows that hold the line colour)
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVE.L  #$0000FF00,D1
    MOVEQ   #80,D0
    TRAP    #15
    MOVE.W  #0,D1
    MOVE.W  #470,D2
    MOVE.W  #639,D3
    MOVE.W  #470,D4
    MOVEQ   #84,D0
    TRAP    #15
    BSR     SCAN
    MOVE.W  #$007F,D1
    MOVEQ   #11,D0
    TRAP    #15
    MOVEQ   #10,D1
    MOVEQ   #6,D0
    TRAP    #15
    BSR     SCAN
    JSR     DMP_CLOSE
    SIMHALT
* writes "Y=yyyy" for every y at x = 300 whose pixel is not black
SCAN:
    MOVEQ   #0,D5
SCANL:
    MOVE.W  #300,D1
    MOVE.W  D5,D2
    MOVEQ   #83,D0
    TRAP    #15
    TST.L   D0
    BEQ     SCANN
    MOVE.L  D5,D1
    SWAP    D1
    MOVE.W  D0,D1
    LEA     YTXT,A1
    JSR     DMP_VAL
SCANN:
    ADDQ.W  #1,D5
    CMP.W   #480,D5
    BLO     SCANL
    LEA     ENDTXT,A1
    JSR     DMP_TEXT
    RTS
YTXT   DC.B 'Y',0
ENDTXT DC.B 'scan',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START