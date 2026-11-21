*-----------------------------------------------------------
* Title      :
* Written by :
* Date       :
* Description:
*-----------------------------------------------------------
    ORG    $1000
START:                  ; first instruction of program

BounceSpriteLoop:
    JSR     JumpToColourStateHandler
    
    JSR     DisplayBackgroundSprite
    JSR     MoveSprite
    JSR     DisplayForegroundSprite
    
    JSR     WaitABit
    BRA     BounceSpriteLoop

    SIMHALT                     ; halt simulator

JumpToColourStateHandler:
    MOVE.B  ColourState,D0
    EXT.W   D0
    LSL.W   #2,D0
    LEA     ColourStateTable,A0
    MOVE.L  0(A0,D0.W),A2
    JSR     (A2)
    RTS
    
DisplayBackgroundSprite:
    JSR     SetCursorPosition
    JSR     MoveColourToD1
    JSR     SetSpriteColour
    JSR     OutputSprite
    RTS
    
DisplayForegroundSprite:
    JSR     SetCursorPosition
    MOVE.L  #$0000FF00,D1
    JSR     SetSpriteColour
    JSR     OutputSprite
    RTS
    
MoveSprite:
    LEA     Sprite,A0
    MOVE.B  SPRITE_X(A0),D0
    ADD.B   SPRITE_DX(A0),D0    ;move col 
    MOVE.B  D0,SPRITE_X(A0)

    CMP.B   #0,D0               ;if sprite is on left edge, bounce
    BEQ     NegateX
    CMP.B   #69,D0              ;if sprint is on right edge, bounce
    BEQ     NegateX
    BRA     ContinueX
NegateX:
    MOVE.B  SPRITE_DX(A0),D0
    NEG.B   D0
    MOVE.B  D0,SPRITE_DX(A0)
ContinueX:
    MOVE.B  SPRITE_Y(A0),D0
    ADD.B   SPRITE_DY(A0),D0    ;move row
    MOVE.B  D0,SPRITE_Y(A0)

    CMP.B   #0,D0               ;if sprite is on top edge, bounce
    BEQ     NegateY
    CMP.B   #31,D0              ;if sprite is on bottom edge, bounce
    BEQ     NegateY
    BRA     ContinueY
NegateY:
    MOVE.B  SPRITE_DY(A0),D0
    NEG.B   D0
    MOVE.B  D0,SPRITE_DY(A0)
ContinueY:
    RTS
    
WaitABit:
    MOVE.W  #10000,D0
WaitABitLoop:
    SUBQ.W  #1,D0
    BNE     WaitABitLoop
    RTS

ColourState0_RedUp:
    ADDQ.B  #1,Red
    CMP.B   #255,Red
    BNE     State0Done
    JSR     IncrementColourState
State0Done:
    RTS

ColourState1_GreenUp:
    ADDQ.B  #1,Green
    CMP.B   #255,Green
    BNE     State1Done
    JSR     IncrementColourState
State1Done:
    RTS
    
ColourState2_RedDown:
    SUBQ.B  #1,Red
    CMP.B   #0,Red
    BNE     State2Done
    JSR     IncrementColourState
State2Done:
    RTS
    
ColourState3_BlueUp:
    ADDQ.B  #1,Blue
    CMP.B   #255,Blue
    BNE     State3Done
    JSR     IncrementColourState
State3Done:
    RTS

ColourState4_GreenDown:
    SUBQ.B  #1,Green
    CMP.B   #0,Green
    BNE     State4Done
    JSR     IncrementColourState
State4Done:
    RTS

ColourState5_RedUp:
    ADDQ.B  #1,Red
    CMP.B   #255,Red
    BNE     State5Done
    JSR     IncrementColourState
State5Done:
    RTS

ColourState6_BlueDown:
    SUBQ.B  #1,Blue
    CMP.B   #0,Blue
    BNE     State6Done
    JSR     IncrementColourState
State6Done:
    RTS
    
ColourState7_RedDown:
    SUBQ.B  #1,Red
    CMP.B   #0,Red
    BNE     State7Done
    JSR     IncrementColourState
State7Done:
    RTS

IncrementColourState:
    ADD.B   #1,ColourState
    CMP.B   #8,ColourState
    BNE     SkipCycle
    CLR.B   ColourState
SkipCycle:
    RTS

SetCursorPosition:
    LEA     Sprite,A0
    MOVE.B  SPRITE_X(A0),D1 ;load col into low byte of d1
    LSL.W   #8,D1           ;shift the low byte of d1 over to high byte
    MOVE.B  SPRITE_Y(A0),D1 ;load row into low byte of d1
    MOVE.B  #11,D0          ;load command to position cursor
    TRAP    #15
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
    
MoveColourToD1:
    MOVEQ   #0,D1
    MOVE.B  Blue,D1
    LSL.L   #8,D1
    OR.B    Green,D1
    LSL.L   #8,D1
    OR.B    Red,D1
    RTS

* Constants
SPRITE_X    EQU     0
SPRITE_Y    EQU     1
SPRITE_DX   EQU     2
SPRITE_DY   EQU     3

* Variables
Message     DC.B    'Hello World',0
Red         DC.B    0
Green       DC.B    0
Blue        DC.B    0
ColourState DC.B    0
Sprite:
            DC.B    0   ;x
            DC.B    0   ;y
            DC.B    1   ;dx
            DC.B    1   ;dy
ColourStateTable:
            DC.L    ColourState0_RedUp
            DC.L    ColourState1_GreenUp
            DC.L    ColourState2_RedDown
            DC.L    ColourState3_BlueUp
            DC.L    ColourState4_GreenDown
            DC.L    ColourState5_RedUp
            DC.L    ColourState6_BlueDown
            DC.L    ColourState7_RedDown

    END    START        ; last line of source


*~Font name~Courier New~
*~Font size~10~
*~Tab type~1~
*~Tab size~4~
