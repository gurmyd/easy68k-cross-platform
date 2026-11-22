*-----------------------------------------------------------
* Title      : x02-text-and-fonts
* Purpose    : whole-program pixel regression (X3): text of task 14 and task 95 in the raster faces
*              (Fixedsys, Courier) and the outline faces (Courier New, Lucida Console, Consolas),
*              in every style and in colour, over a filled text background.
*-----------------------------------------------------------
        ORG     $1000
START:
        MOVE.L  #$00802020,D1       fill colour: text cells take it
        MOVEQ   #81,D0
        TRAP    #15
        LEA     HELLO,A1            default font at home
        MOVEQ   #14,D0
        TRAP    #15
        LEA     FONTS,A2            a table: colour, font word, position, then a string
LOOP:   MOVE.L  (A2)+,D1
        BEQ     DONE
        MOVE.L  (A2)+,D2
        MOVEQ   #21,D0              set colour and font
        TRAP    #15
        MOVE.L  (A2)+,D6            where to draw: x in the high word, y in the low word
        MOVE.L  D6,D2
        SWAP    D6
        MOVE.W  D6,D1
        MOVE.L  A2,A1
        MOVEQ   #95,D0              draw text at x, y
        TRAP    #15
FIND:   TST.B   (A2)+               skip the string and its padding up to a word
        BNE     FIND
        MOVE.L  A2,D7
        ADDQ.L  #1,D7
        AND.L   #$FFFFFFFE,D7
        MOVE.L  D7,A2
        BRA     LOOP
DONE:   MOVE.L  #$00FFFFFF,D1       back to the Options font
        MOVEQ   #0,D2
        MOVEQ   #21,D0
        TRAP    #15
        MOVE.W  #$0A05,D1           task 11: column 10, row 5
        MOVEQ   #11,D0
        TRAP    #15
        LEA     GRID,A1
        MOVEQ   #14,D0
        TRAP    #15
        SIMHALT
HELLO:  DC.B    'Whole-program pixel test',13,10,0
GRID:   DC.B    'Cursor moved: task 11',0
        DS.W    0
FONTS:  DC.L    $00FFFFFF,$01090000,$00100040
        DC.B    'Fixedsys 9',0
        DS.W    0
        DC.L    $0000FF00,$020A0000,$00100060
        DC.B    'Courier 10 regular',0
        DS.W    0
        DC.L    $0000FFFF,$020C0001,$00100080
        DC.B    'Courier 12 bold',0
        DS.W    0
        DC.L    $00FFFF00,$030A0000,$001000A0
        DC.B    'Courier New 10 regular',0
        DS.W    0
        DC.L    $00FF00FF,$030C0001,$001000C0
        DC.B    'Courier New 12 bold',0
        DS.W    0
        DC.L    $000080FF,$030E0002,$001000E0
        DC.B    'Courier New 14 italic',0
        DS.W    0
        DC.L    $00FFFFFF,$04090004,$00100110
        DC.B    'Lucida Console 9 underline',0
        DS.W    0
        DC.L    $0080FF80,$060B0008,$00100130
        DC.B    'Consolas 11 strike-out',0
        DS.W    0
        DC.L    $00FFFFFF,$06120000,$00100150
        DC.B    'Consolas 18',0
        DS.W    0
        DC.L    0
        END     START
