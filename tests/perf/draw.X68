*-----------------------------------------------------------------------------
* draw.X68 - continuous drawing that never ends
*
* Part of easy68k-mac (GPL-2.0-or-later). Owner: work package P1
* (docs/ARCHITECTURE.md 6.9 item 9; docs/porting/speed.md).
*
* The fixed program of the frame measurements: a double-buffered animation
* with no delay, the way a student's game loop draws. Every pass clears the
* back buffer, draws eight filled rectangles that move to the right, a line
* from the centre to a point that runs along the top edge and a filled ball,
* and then shows the back buffer with TRAP #15 task 94. It runs as fast as
* the simulator lets it, so the drawing never stops; D7 counts the passes.
* Stop it with Pause (F6).
*-----------------------------------------------------------------------------

        ORG     $1000
START:  MOVEQ   #17,D1
        MOVEQ   #92,D0                  ; double buffering on
        TRAP    #15
        MOVEQ   #0,D7                   ; passes

FRAME:  MOVE.W  #$FF00,D1
        MOVEQ   #11,D0                  ; clear the back buffer
        TRAP    #15

        MOVEQ   #7,D6                   ; eight rectangles, D6 = 7 .. 0
RECT:   MOVE.W  D6,D5
        LSL.W   #2,D5
        LEA     COLORS,A0
        MOVE.L  0(A0,D5.W),D1
        MOVEQ   #81,D0                  ; fill colour
        TRAP    #15
        MOVEQ   #80,D0                  ; pen colour, the same
        TRAP    #15
        MOVE.W  D7,D1
        LSL.W   #2,D1                   ; pass * 4
        MOVE.W  D6,D2
        LSL.W   #6,D2                   ; index * 64
        ADD.W   D2,D1
        AND.W   #511,D1
        ADD.W   #20,D1                  ; left: 20 .. 531
        MOVE.W  D6,D2
        MULU    #56,D2
        ADD.W   #16,D2                  ; top: 16 .. 408
        MOVE.W  D1,D3
        ADD.W   #80,D3                  ; right
        MOVE.W  D2,D4
        ADD.W   #40,D4                  ; bottom
        MOVEQ   #87,D0                  ; filled rectangle
        TRAP    #15
        DBRA    D6,RECT

        MOVE.L  #$00FFFFFF,D1
        MOVEQ   #80,D0                  ; white pen
        TRAP    #15
        MOVE.W  #320,D1
        MOVE.W  #240,D2
        MOVE.W  D7,D3
        AND.W   #511,D3
        ADD.W   #64,D3
        MOVEQ   #0,D4
        MOVEQ   #84,D0                  ; line from the centre to the top edge
        TRAP    #15

        MOVE.L  #$0000FFFF,D1
        MOVEQ   #81,D0                  ; yellow fill
        TRAP    #15
        MOVE.W  D7,D1
        MULU    #3,D1
        AND.W   #511,D1
        ADD.W   #40,D1
        MOVE.W  #380,D2
        MOVE.W  D1,D3
        ADD.W   #60,D3
        MOVE.W  #440,D4
        MOVEQ   #88,D0                  ; filled ellipse
        TRAP    #15

        MOVEQ   #94,D0                  ; show the back buffer
        TRAP    #15
        ADDQ.L  #1,D7
        BRA     FRAME

COLORS  DC.L    $000000FF,$0000FF00,$00FF0000,$0000FFFF
        DC.L    $00FF00FF,$00FFFF00,$00808080,$004080FF

        END     START
