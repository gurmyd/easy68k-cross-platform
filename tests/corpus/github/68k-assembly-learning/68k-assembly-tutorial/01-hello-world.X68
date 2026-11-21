*-----------------------------------------------------------
* Title      :
* Written by :
* Date       :
* Description:
*-----------------------------------------------------------
    ORG    $1000
START:                  ; first instruction of program

* Put program code here
    lea     message,a1      ;hello world message
    move.b  #1,d4           ;start moving down
    move.b  #1,d5           ;start moving right
    move.b  #0,d6           ;col
    move.b  #5,d7           ;row

LOOP:
    move.b  d6, d1          ;load row into low byte of d1
    lsl.w   #8, d1          ;shift the low byte of d1 over to high byte
    move.b  d7, d1          ;load col into low byte of d1
    move.b  #11, d0         ;load command to position cursor
    trap    #15
    
    move.l  #$00000000,d1   ;set colour to BLACK
    move.b  #0, d2          ;set style
    move.b  #21, d0         ;set text colour code
    trap    #15
    
    move.b  #14, d0         ;load command to output text
    trap    #15
    
    add.b   d5, d6          ;move col 
    cmp.b   #0, d6          ;if Hello World is all the way left, send it right
    beq     NEGATEX
    cmp.b   #69, d6         ;if Hello World is all the way right, send it left
    beq     NEGATEX
    bra     CONTINUEX
    NEGATEX:
        neg.b   d5
    CONTINUEX:
    
    add.b   d4, d7          ;move row
    cmp.b   #0, d7          ;if Hello World is all the way up top, send it down
    beq     NEGATEY
    cmp.b   #31, d7         ;if Hello World is all the way at bottom, send it up
    beq     NEGATEY
    bra     CONTINUEY
    NEGATEY:
        neg.b   d4
    CONTINUEY:
    
    move.b  d6, d1          ;load row into low byte of d1
    lsl.w   #8, d1          ;shift the low byte of d1 over to high byte
    move.b  d7, d1          ;load col into low byte of d1
    move.b  #11, d0         ;load command to position cursor
    trap    #15
    
    move.l  #$0000ff00, d1  ;set colour to GREEN
    move.b  #0, d2          ;no style
    move.b  #21, d0         ;set text colour
    trap    #15
        
    move.b  #14, d0         ;load command to output text
    trap    #15
      
    move.w  #10000, d0
    LOOPWAIT:
      subq.w    #1, d0
      bne       LOOPWAIT
      
    bra     LOOP            ;loop
    
    SIMHALT                 ; halt simulator

* Put variables and constants here
message     dc.b    'Hello World',0
red         dc.b    0
green       dc.b    0
blue        dc.b    0
    
    END START        ; last line of source
    



*~Font name~Courier New~
*~Font size~10~
*~Tab type~1~
*~Tab size~4~
