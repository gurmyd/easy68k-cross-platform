*-----------------------------------------------------------
* Title      : moire-lines
* Written by : Henry Wrightson
* Date       : 14/8/2026
* Description: Plot diagonal lines using a Bresenham Algorithm
*            : to create moire patterns across the screen
*-----------------------------------------------------------
    org     $1000
Start:
    lea     ColourStateTable,a0
    
    jsr     SetScreenRes
.LoopForever
    jsr     DrawMoire
    bra.s   .LoopForever

    bra     Finish

DrawMoire:
    move.w  #RES_X,d0       ; 800
    sub.w   #MOIRE_X,d0     ; 800-550 = 250
    divu.w  #2,d0           ; 250/2 = 125
    move.w  d0,offset_x

    move.w  #RES_Y,d0       ; 600
    sub.w   #MOIRE_Y,d0     ; 600-550 = 50
    divu.w  #2,d0           ; 50/2 = 25
    move.w  d0,offset_y
    
    move.w  offset_x,d4     ; x0
    move.w  offset_y,d5     ; y0
    move.w  #MOIRE_X,d6     ; x1
    add.w   offset_x,d6
    move.w  #MOIRE_Y,d7     ; y1
    add.w   offset_y,d7
.LoopX:                 ; loop along the x axis from left to right
    jsr     DrawLineFast        ; choose one, but this is way faster
    ;jsr     DrawLineBresenham
    
    addq    #MOVE_X,d4
    subq    #MOVE_X,d6
    cmp.w   offset_x,d6
    bge.s   .LoopX
    
    move.w  offset_x,d4
    move.w  #MOIRE_Y,d5
    add.w   offset_y,d5
    move.w  #MOIRE_X,d6
    add.w   offset_x,d6
    move.w  offset_y,d7
.LoopY:                  ; loop from MOIRE_Y to 0 along the y-axis
    jsr     DrawLineFast        ; choose one, but this is way faster
    ;jsr     DrawLineBresenham
    
    subq    #MOVE_Y,d5    
    addq    #MOVE_Y,d7
    cmp.w   offset_y,d5
    bge.s   .LoopY
    rts

DrawLineFast:           ; draw a line from (d4,d5) to (d6,d7) using the built in routines
    move.l  d4,-(sp)
    
    jsr     CycleColour
.SkipColourCycle:

    moveq   #80,d0      ; set pen colour
    jsr     MoveColourToD1
    trap    #15
    
    moveq   #84,d0
    move.w  d4,d1
    move.w  d5,d2
    move.w  d6,d3
    move.w  d7,d4
    trap    #15
    
    move.l  (sp)+,d4
    jsr     WaitABit
    
    rts
    
DrawLineBresenham:      ; draw a line from (d4,d5) to (d6,d7) using the Bresenham Algorithm d2=e2  d3=error d4=x0  d5=y0  d6=x1  d7=y1
    jsr     CycleColour
    
    move.w  d6,d0       ; const dx = Math.abs(x1 - x0)
    sub.w   d4,d0
    jsr     PositiveD0
    move.w  d0,dx
    
    move.w  d7,d0       ; const dy = -Math.abs(y1 - y0)
    sub.w   d5,d0
    jsr     NegativeD0
    move.w  d0,dy
    
    move.w  #1,sx       ; const sx = x0 < x1 ? 1 : -1
    cmp.w   d6,d4
    blo     .X0LessThanX1
    move.w  #-1,sx
.X0LessThanX1:

    move.w  #1,sy       ; const sy = y0 < y1 ? 1 : -1
    cmp.w   d7,d5
    blo     .Y0LessThanY1
    move.w  #-1,sy
.Y0LessThanY1:

    move.w  dx,d3       ; let error = dx + dy
    add.w   dy,d3
    move.w  d4,x        ; let x = x0
    move.w  d5,y        ; let y = y0
.Loop:                  ; while (true) {
    jsr     PlotPoint   ;   Plot(x, y)
    
    move.w  d3,d2       ;   const e2 = 2 * error
    muls.w  #2,d2

.MoveX:
    cmp.w   dy,d2       ;   if (dy < e2) {
    blt.s   .MoveY
    cmp.w   x,d6        ;     if (x == x1) break
    beq.s   .EndLoop
    add.w   dy,d3       ;     error = error + dy
    move.w  x,d0        ;     x = x + sx
    add.w   sx,d0
    move.w  d0,x
                        ;   }
.MoveY:
    cmp.w   dx,d2       ;   if (dx >= e2) {
    bge.s   .Loop
    cmp.w   y,d7        ;     if (y == y1) break
    beq.s   .EndLoop
    add.w   dx,d3       ;     error = error + dx
    move.w  y,d0        ;     y = y + sy
    add.w   sy,d0
    move.w  d0,y
    bra.s   .Loop
                        ;   }
.EndLoop:               ; }
    rts

PositiveD0:             ; convert d0 to a positive number
    tst.w   d0
    bpl.s   .Positive
    neg.w   d0
.Positive:
    rts
    
NegativeD0:             ; convert d0 to a negative number
    tst.w   d0
    bmi.s   .Negative
    neg.w   d0
.Negative:
    rts
    
ClearScreen:
    moveq   #11,d0
    move.w  #$ff00,d1
    trap    #15
    rts

SetScreenRes:
    move.b  #33,d0      ; Set screen to 640x480
    move.l  #RES_X*$10000+RES_Y,d1
    trap    #15
    rts
    
PlotPoint:              ; plot a point at x,y
    moveq   #80,d0      ; set pen colour
    jsr     MoveColourToD1
    trap    #15

    moveq   #82,d0      ; draw pixel at x,y
    move.w  x,d1
    move.w  y,d2
    trap    #15
    rts
    
CycleColour:
    move.b  counter,d0
    subq    #1,d0
    move.b  d0,counter
    tst.b   d0
    beq     .TriggerCycle
    bra.s   .SkipTriggers
    
.TriggerCycle:
    move.b  #CYCLE_FREQUENCY,counter
    
    moveq   #0,d0
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

    rts

MoveColourToD1:
    moveq   #0,d1
    move.b  Blue,d1
    lsl.l   #8,d1
    or.b    Green,d1
    lsl.l   #8,d1
    or.b    Red,d1
    rts

WaitABit:
    move.w  #4000,d0
.Loop:
    dbra    d0,.Loop
    rts
    
Finish:
    simhalt

; Moire constants
RES_X               equ     650
RES_Y               equ     650
MOIRE_X             equ     650
MOIRE_Y             equ     650
MOVE_X              equ     3
MOVE_Y              equ     3
COLOUR_GREEN        equ     $00008000
COLOUR_WHITE        equ     $00ffffff

; Colour constants
COLOURSTATE_DR      equ     0       ; Offsets
COLOURSTATE_DG      equ     1
COLOURSTATE_DB      equ     2
COLOURSTATE_TR      equ     3
COLOURSTATE_TG      equ     4
COLOURSTATE_TB      equ     5

COLOUR_STATE_TABLE_WIDTH    equ 6   ; constants
LAST_COLOUR_STATE   equ     6
CYCLE_FREQUENCY     equ     6

; Moire variables
x           dc.w    0
y           dc.w    0
dx          dc.w    0
dy          dc.w    0
sx          dc.w    0
sy          dc.w    0
offset_x    dc.w    0
offset_y    dc.w    0
counter     dc.b    1

* Colour variables with their starting values
Red                 dc.b    $ff
Green               dc.b    $00
Blue                dc.b    $00
ColourState         dc.b    0

; Colour structures
* DeltaR, DeltaG, DeltaB, TriggerR, TriggerG, TriggerB
* The Delta is how much to change each RGB value
* The Trigger is the condition that causes a state change, when R,G,B = TriggerR,TriggerG,TriggerB
ColourStateTable:   DC.B     0, 1, 0, $ff, $ff, $00 ;red     >  yellow
                    DC.B    -1, 0, 0, $00, $ff, $00 ;yellow  >  green
                    DC.B     0, 0, 1, $00, $ff, $ff ;green   >  cyan
                    DC.B     0,-1, 0, $00, $00, $ff ;cyan    >  blue
                    DC.B     1, 0, 0, $ff, $00, $ff ;blue    >  magenta
                    DC.B     0, 0,-1, $ff, $00, $00 ;magenta >  red
                    
    end     Start





*~Font name~Courier New~
*~Font size~10~
*~Tab type~1~
*~Tab size~4~
