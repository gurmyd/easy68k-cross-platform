*-----------------------------------------------------------
* Title      : keyboard-input
* Written by : Henry Wrighson
* Date       : 14/8/2026
* Description: Read the cursor keys and output which have been pressed
*-----------------------------------------------------------
    org     $1000
Start:
    lea     Spinner,a2
    
Loop:
    jsr     Clear
    
    moveq   #19,d0
    move.l  #$25<<24+$27<<16+$26<<8+$28,d1  ; check for keypress Left, Right, Up, Down    
    trap    #15

    btst.l  #24,d1
    bne     LeftKey

    btst.l  #16,d1
    bne     RightKey
    
    btst.l  #8,d1
    bne     UpKey
    
    btst.l  #0,d1
    bne     DownKey
    
    jsr     OutputSpinner
    move    #MessageSpinner,a1
    bra.s   Output
    
LeftKey:
    move    #MessageLeft,a1
    bra.s   Output
RightKey:
    move    #MessageRight,a1
    bra.s   Output
UpKey:
    move    #MessageUp,a1
    bra.s   Output
DownKey:
    move    #MessageDown,a1
    bra.w   Output
Output:
    move.b  #13,d0
    trap    #15
    bra.s   Loop

Clear:
    moveq   #11,d0
    move.w  #$0000,d1
    trap    #15
    
    moveq   #14,d0
    move    #Message,a1
    trap    #15
    rts

OutputSpinner:        
    move.b  Trigger,d0
    subq    #1,d0
    move.b  d0,Trigger
    
    move.b  0(a2,d0.w),d1
    move.b  #6,d0
    trap    #15
    
    move.b  Trigger,d0
    tst.b   d0
    beq.s   .Zero
    rts
.Zero
    move.b  #4,Trigger
    rts
    
    simhalt

; constants
Message         dc.b    'Key pressed: ',0
MessageLeft     dc.b    'Left ',0
MessageRight    dc.b    'Right',0
MessageUp       dc.b    'Up   ',0
MessageDown     dc.b    'Down ',0
MessageSpinner  dc.b    '    ',0
Trigger         dc.b    4

Spinner: dc.b '\','-','/','|'

    end     Start

*~Font name~Courier New~
*~Font size~10~
*~Tab type~1~
*~Tab size~4~
