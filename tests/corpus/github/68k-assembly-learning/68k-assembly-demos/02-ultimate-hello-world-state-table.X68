*-----------------------------------------------------------
* Title      : Ultimate Hello World using State Table Record
* Written by : Henry Wrightson
* Date       : 07/08/2026
* Description: Bounce 'Hello World' around the screen while 
*            : cycling through the RGB spectrum
*-----------------------------------------------------------
    ORG    $1000
START:                  ; first instruction of program

    LEA     ColourStateTable,A0
    
BounceSpriteLoop:
    JSR     IncrementColours
    
    JSR     DisplayBackgroundSprite
    JSR     MoveSprite
    JSR     DisplayForegroundSprite
    
    JSR     WaitABit
    BRA     BounceSpriteLoop
    
    SIMHALT

IncrementColours:
    MOVE.B  COLOURSTATE_DR(A0),D0
    ADD.B  D0,Red
    MOVE.B  COLOURSTATE_DG(A0),D0
    ADD.B  D0,Green
    MOVE.B  COLOURSTATE_DB(A0),D0
    ADD.B  D0,Blue
    
    MOVE.B  COLOURSTATE_TR(A0),D0
    CMP.B   Red,D0
    BNE     SkipTriggers
    
    MOVE.B  COLOURSTATE_TG(A0),D0
    CMP.B   Green,D0
    BNE     SkipTriggers
    
    MOVE.B  COLOURSTATE_TB(A0),D0
    CMP.B   Blue,D0
    BNE     SkipTriggers
    JSR     NextColourState
SkipTriggers:
    RTS

NextColourState:
    ADDQ.B  #1,ColourState
    MOVE.B  ColourState,D0
    CMPI.B  #LAST_COLOUR_STATE,D0
    BNE     SkipStateRollover
    CLR.B   ColourState
SkipStateRollover:
    JSR     MoveColourStateRecord
    RTS

MoveColourStateRecord:
    MOVE.B  ColourState,D0
    MOVEQ   #COLOUR_STATE_TABLE_WIDTH,D1
    MULU.W  D1,D0           ; multiply by record size

    LEA     ColourStateTable,A0
    ADDA.W  D0,A0

    RTS
        
DisplayBackgroundSprite:
    JSR     SetCursorPosition
    JSR     MoveColourToD1
    JSR     SetSpriteColour
    JSR     OutputSprite
    RTS
    
DisplayForegroundSprite:
    JSR     SetCursorPosition
    MOVE.L  #FOREGROUND_COLOUR,D1
    JSR     SetSpriteColour
    JSR     OutputSprite
    RTS

SetCursorPosition:
    LEA     Sprite,A2
    MOVE.B  SPRITE_X(A2),D1 ;load col into low byte of d1
    LSL.W   #8,D1           ;shift the low byte of d1 over to high byte
    MOVE.B  SPRITE_Y(A2),D1 ;load row into low byte of d1
    MOVE.B  #11,D0          ;load command to position cursor
    TRAP    #15
    RTS

MoveColourToD1:
    MOVEQ   #0,D1
    MOVE.B  Blue,D1
    LSL.L   #8,D1
    OR.B    Green,D1
    LSL.L   #8,D1
    OR.B    Red,D1
    RTS

SetSpriteColour:    
    MOVE.B  #0,D2           ;set style
    MOVE.B  #21,D0          ;set text colour code
    TRAP    #15
    RTS

OutputSprite:    
    LEA     Message,A1      ;hello world message
    MOVE.B  #14,D0          ;load command to output text
    TRAP    #15
    RTS
    
MoveSprite:
    LEA     Sprite,A2
    MOVE.B  SPRITE_X(A2),D0
    ADD.B   SPRITE_DX(A2),D0    ;move col 
    MOVE.B  D0,SPRITE_X(A2)

    CMP.B   #0,D0               ;if sprite is on left edge, bounce
    BEQ     NegateX
    CMP.B   #SCREEN_W,D0        ;if sprint is on right edge, bounce
    BEQ     NegateX
    BRA     ContinueX
NegateX:
    MOVE.B  SPRITE_DX(A2),D0
    NEG.B   D0
    MOVE.B  D0,SPRITE_DX(A2)
ContinueX:
    MOVE.B  SPRITE_Y(A2),D0
    ADD.B   SPRITE_DY(A2),D0    ;move row
    MOVE.B  D0,SPRITE_Y(A2)

    CMP.B   #0,D0               ;if sprite is on top edge, bounce
    BEQ     NegateY
    CMP.B   #SCREEN_H,D0        ;if sprite is on bottom edge, bounce
    BEQ     NegateY
    BRA     ContinueY
NegateY:
    MOVE.B  SPRITE_DY(A2),D0
    NEG.B   D0
    MOVE.B  D0,SPRITE_DY(A2)
ContinueY:
    RTS
    
WaitABit:
    MOVE.W  #10000,D0
WaitABitLoop:
    SUBQ.W  #1,D0
    BNE     WaitABitLoop
    RTS

* Offsets
SPRITE_X            EQU     0
SPRITE_Y            EQU     1
SPRITE_DX           EQU     2
SPRITE_DY           EQU     3
    
COLOURSTATE_DR      EQU     0
COLOURSTATE_DG      EQU     1
COLOURSTATE_DB      EQU     2
COLOURSTATE_TR      EQU     3
COLOURSTATE_TG      EQU     4
COLOURSTATE_TB      EQU     5

SCREEN_W            EQU     68
SCREEN_H            EQU     31

* Constants
COLOUR_STATE_TABLE_WIDTH    EQU 6
LAST_COLOUR_STATE   EQU     6
FOREGROUND_COLOUR   EQU     $0000FF00

* Variables
Message             DC.B    'Hello World',0
Sprite:             DC.B    0   ;x
                    DC.B    0   ;y
                    DC.B    1   ;dx
                    DC.B    1   ;dy

* Colour variables for the current sprite, with their starting values
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
