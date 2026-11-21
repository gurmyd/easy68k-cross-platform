    ORG     $1000

Start:
    lea Intro,a1
    moveq   #14,d0
    trap    #15
    
    bra     CheckKeys

CheckKeys:
    moveq   #19,d0
    moveq   #0,d1
    trap    #15

    tst.w   d1
    beq.s   CheckKeys

    move.w  d1,d3             ; Save key code

    ; Cursor to 0,0
    moveq   #11,d0
    moveq   #0,d1
    trap    #15

    ; "Pressed key code: "
    lea     Message,a1
    moveq   #14,d0
    trap    #15

    ; #
    lea     Hash,a1
    moveq   #14,d0
    trap    #15

    ; Decimal
    move.w  d3,d1
    moveq   #10,d2
    moveq   #15,d0
    trap    #15

    ; $
    lea     Dollar,a1
    moveq   #14,d0
    trap    #15

    ; Hex
    move.w  d3,d1
    moveq   #16,d2
    moveq   #15,d0
    trap    #15

    bra.s   CheckKeys

    SIMHALT

Intro   dc.b    'Press a key',0
Message dc.b    'Pressed key ASCII code: ',0
Hash    dc.b    ' #',0
Dollar  dc.b    ' $',0

    END     Start
*~Font name~Courier New~
*~Font size~10~
*~Tab type~1~
*~Tab size~4~
