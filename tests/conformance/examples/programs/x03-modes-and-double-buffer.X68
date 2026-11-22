*-----------------------------------------------------------
* Title      : x03-modes-and-double-buffer
* Purpose    : whole-program pixel regression (X3): the sixteen drawing modes of task 92 on
*              overlapping rectangles, lines and ellipses, then double buffering (mode 17):
*              pictures drawn after the last repaint (task 94) are in the back buffer and not
*              on the screen.
*-----------------------------------------------------------
        ORG     $1000
START:
        MOVEQ   #0,D6                   mode
MODES:  MOVE.L  #$00F0A060,D1           the background stripe
        MOVEQ   #80,D0
        TRAP    #15
        MOVEQ   #81,D0
        TRAP    #15
        MOVEQ   #4,D1                   copy mode
        MOVEQ   #92,D0
        TRAP    #15
        MOVE.W  D6,D1                   column = 38 * mode
        MULU    #38,D1
        MOVE.W  D1,D3
        ADD.W   #32,D3
        MOVE.W  #10,D2
        MOVE.W  #230,D4
        MOVEQ   #87,D0                  filled rectangle
        TRAP    #15
        MOVE.L  D6,D1                   the mode under test
        MOVEQ   #92,D0
        TRAP    #15
        MOVE.L  #$0030C0E0,D1
        MOVEQ   #80,D0
        TRAP    #15
        MOVE.L  #$00A04080,D1
        MOVEQ   #81,D0
        TRAP    #15
        MOVE.W  D6,D1
        MULU    #38,D1
        MOVE.W  D1,D3
        ADD.W   #32,D3
        ADD.W   #6,D1
        MOVE.W  #40,D2
        MOVE.W  #100,D4
        MOVEQ   #87,D0                  rectangle in the mode
        TRAP    #15
        MOVE.W  D6,D1
        MULU    #38,D1
        ADD.W   #4,D1
        MOVE.W  #110,D2
        MOVE.W  D1,D3
        ADD.W   #24,D3
        MOVE.W  #170,D4
        MOVEQ   #88,D0                  ellipse in the mode
        TRAP    #15
        MOVE.W  D6,D1
        MULU    #38,D1
        MOVE.W  #20,D2
        MOVE.W  D1,D3
        ADD.W   #32,D3
        MOVE.W  #220,D4
        MOVEQ   #84,D0                  a line in the mode
        TRAP    #15
        ADDQ.W  #1,D6
        CMP.W   #16,D6
        BNE     MODES
* double buffering: draw, repaint, draw more (the last mode of the loop is not a copy mode)
        MOVEQ   #4,D1
        MOVEQ   #92,D0
        TRAP    #15
        MOVEQ   #17,D1
        MOVEQ   #92,D0
        TRAP    #15
        MOVE.L  #$000000FF,D1
        MOVEQ   #81,D0
        TRAP    #15
        MOVE.W  #20,D1
        MOVE.W  #260,D2
        MOVE.W  #300,D3
        MOVE.W  #400,D4
        MOVEQ   #88,D0
        TRAP    #15
        MOVEQ   #94,D0                  repaint: the window shows the back buffer
        TRAP    #15
        MOVE.L  #$0000FF00,D1
        MOVEQ   #81,D0
        TRAP    #15
        MOVE.W  #200,D1
        MOVE.W  #300,D2
        MOVE.W  #500,D3
        MOVE.W  #450,D4
        MOVEQ   #87,D0                  not repainted: only in the back buffer
        TRAP    #15
        SIMHALT
        END     START
