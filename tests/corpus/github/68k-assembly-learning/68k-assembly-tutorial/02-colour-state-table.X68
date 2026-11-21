*-----------------------------------------------------------
* Title      :
* Written by :
* Date       :
* Description:
*-----------------------------------------------------------
    ORG    $1000
Start:                  ; first instruction of program

* Put program code here    
    LEA     Message,A1
    
CycleColour:
    JSR     JumpToColourStateHandler
    JSR     OutputColour
    BRA     CycleColour

    SIMHALT             ; halt simulator

        
JumpToColourStateHandler:
    MOVE.B  ColourState,D0
    EXT.W   D0
    LSL.W   #2,D0
    LEA     ColourStateTable,A0
    MOVE.L  0(A0,D0.W),A2
    JSR     (A2)
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

OutputColour:
    MOVE.B  #0,D1           ;load row into low byte of d1
    LSL.W   #8,D1           ;shift the low byte of d1 over to high byte
    MOVE.B  #0,D1           ;load col into low byte of d1
    MOVE.B  #11,D0          ;load command to position cursor
    TRAP    #15
    
    JSR     MoveColourToD1  ;set colour
    MOVE.B  #0,D2           ;set style
    MOVE.B  #21,D0          ;set text colour code
    TRAP    #15
    
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

* Put variables and constants here
Message     DC.B    'Hello World',0
Red         DC.B    0
Green       DC.B    0
Blue        DC.B    0
ColourState DC.B    0
ColourStateTable:
            DC.L    ColourState0_RedUp
            DC.L    ColourState1_GreenUp
            DC.L    ColourState2_RedDown
            DC.L    ColourState3_BlueUp
            DC.L    ColourState4_GreenDown
            DC.L    ColourState5_RedUp
            DC.L    ColourState6_BlueDown
            DC.L    ColourState7_RedDown
            
    END    Start        ; last line of source

*~Font name~Courier New~
*~Font size~10~
*~Tab type~1~
*~Tab size~4~
