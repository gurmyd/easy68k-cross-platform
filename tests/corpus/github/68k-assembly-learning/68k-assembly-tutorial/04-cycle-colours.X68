*-----------------------------------------------------------
* Title      : cycle-colours
* Written by : Henry Wrightson
* Date       : 07/08/2026
* Description: Cycle through the RGB spectrum
*-----------------------------------------------------------
    ORG    $1000
Start:
    lea     ColourStateTable,a0
    
CycleColourLoop:
    jsr     IncrementColours
    jsr     DisplayMessage    
    jsr     WaitABit
    bra.s   CycleColourLoop
    
    SIMHALT

IncrementColours:
    move.b  COLOURSTATE_DR(a0),d0
    add.b   d0,Red
    move.b  COLOURSTATE_DG(a0),d0
    add.b   d0,Green
    move.b  COLOURSTATE_DB(a0),d0
    add.b   d0,Blue
    
    move.b  COLOURSTATE_TR(a0),d0
    cmp.b   Red,d0
    bne.s   .SkipTriggers
    
    move.b  COLOURSTATE_TG(a0),d0
    cmp.b   Green,d0
    bne.s   .SkipTriggers
    
    move.b  COLOURSTATE_TB(a0),d0
    cmp.b   Blue,d0
    bne.s   .SkipTriggers
    jsr     NextColourState
.SkipTriggers:
    rts

NextColourState:
    addq.b  #1,ColourState
    move.b  ColourState,d0
    cmpi.b  #LAST_COLOUR_STATE,d0
    bne     .SkipRollover
    clr.b   ColourState
.SkipRollover:
    jsr     MoveColourStateRecord
    rts

MoveColourStateRecord:
    move.b  ColourState,d0
    moveq   #COLOUR_STATE_TABLE_WIDTH,d1
    mulu.w  d1,d0           ; multiply by record size

    lea     ColourStateTable,a0
    adda.w  d0,a0

    RTS
        
DisplayMessage:
    JSR     SetCursorPosition
    JSR     MoveColourToD1
    JSR     SetMessageColour
    JSR     OutputMessage
    RTS

SetCursorPosition:
    lea     Message,a2
    moveq   #0,d1           ;load col into low byte of d1
    lsl.w   #8,d1           ;shift the low byte of d1 over to high byte
    moveq   #0,d1           ;load row into low byte of d1
    moveq   #11,d0          ;load command to position cursor
    trap    #15
    rts

MoveColourToD1:
    moveq    #0,d1
    move.b  Blue,d1
    lsl.l   #8,d1
    or.b    Green,d1
    lsl.l   #8,d1
    or.b    Red,d1
    rts

SetMessageColour:    
    moveq   #0,d2           ;set style
    moveq   #21,d0          ;set text colour code
    trap    #15
    rts
    
OutputMessage:    
    lea     Message,a1      ;hello world message
    moveq   #14,d0          ;load command to output text
    trap    #15
    rts

WaitABit:
    move.w  #10000,d0
.Loop:
    subq    #1,d0
    bne     .Loop
    rts
    
* Offsets
COLOURSTATE_DR      EQU     0
COLOURSTATE_DG      EQU     1
COLOURSTATE_DB      EQU     2
COLOURSTATE_TR      EQU     3
COLOURSTATE_TG      EQU     4
COLOURSTATE_TB      EQU     5

* Constants
COLOUR_STATE_TABLE_WIDTH    EQU 6
LAST_COLOUR_STATE   EQU     6

* Variables
Message             DC.B    'Hello World',0

* Colour variables with their starting values
Red                 DC.B    $FF
Green               DC.B    $00
Blue                DC.B    $00
ColourState         DC.B    0

* DeltaR, DeltaG, DeltaB, TriggerR, TriggerG, TriggerB
* The Delta is how much to change each RGB value
* The Trigger is the condition that causes a state change, when R,G,B = TriggerR,TriggerG,TriggerB
ColourStateTable:   DC.B     0, 1, 0, $FF, $FF, $00 ;red     >  yellow
                    DC.B    -1, 0, 0, $00, $FF, $00 ;yellow  >  green
                    DC.B     0, 0, 1, $00, $FF, $FF ;green   >  cyan
                    DC.B     0,-1, 0, $00, $00, $FF ;cyan    >  blue
                    DC.B     1, 0, 0, $FF, $00, $FF ;blue    >  magenta
                    DC.B     0, 0,-1, $FF, $00, $00 ;magenta >  red
            
    END    START        ; last line of source





*~Font name~Courier New~
*~Font size~10~
*~Tab type~1~
*~Tab size~4~
