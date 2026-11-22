*-----------------------------------------------------------
* Title      : x01-shapes
* Purpose    : whole-program pixel regression (X3): lines in every direction, filled and
*              unfilled ellipses of many sizes (small ones are table-driven, large ones are
*              computed), wide pens, a flood fill inside a closed outline, clipping at the edges.
*-----------------------------------------------------------
        ORG     $1000
START:
* a closed outline with a flood fill inside it (first, so that nothing crosses the outline)
        MOVE.L  #$00FFFF00,D1
        MOVEQ   #80,D0
        TRAP    #15
        MOVE.L  #$0000FFFF,D1
        MOVEQ   #81,D0
        TRAP    #15
        MOVE.W  #240,D1
        MOVE.W  #350,D2
        MOVE.W  #420,D3
        MOVE.W  #440,D4
        MOVEQ   #90,D0              unfilled rectangle
        TRAP    #15
        MOVE.W  #300,D1
        MOVE.W  #390,D2
        MOVEQ   #89,D0              flood fill
        TRAP    #15
* a fan of lines from the middle to the top and the bottom edge, colour changing with the line
        MOVEQ   #0,D6
FAN:    MOVE.L  D6,D1
        MULU    #$0B0D,D1
        ADD.L   #$00203040,D1
        MOVEQ   #80,D0              set pen colour
        TRAP    #15
        MOVE.W  #320,D1
        MOVE.W  #240,D2
        MOVE.W  D6,D3
        LSL.W   #4,D3               x = 16 * i, up to 640 (outside the surface)
        MOVEQ   #0,D4
        MOVEQ   #84,D0              line
        TRAP    #15
        MOVE.W  #320,D1
        MOVE.W  #240,D2
        MOVE.W  #479,D4
        MOVEQ   #84,D0
        TRAP    #15
        ADDQ.W  #1,D6
        CMP.W   #41,D6
        BNE     FAN
* ellipses: filled and unfilled, sizes 1 to 64 in a row, then large ones
        MOVE.L  #$0000FF00,D1
        MOVEQ   #80,D0
        TRAP    #15
        MOVE.L  #$00FF8000,D1
        MOVEQ   #81,D0              fill colour
        TRAP    #15
        MOVEQ   #1,D6
SMALL:  MOVE.W  D6,D1               left = 8 * size
        LSL.W   #3,D1
        MOVE.W  #20,D2
        MOVE.W  D1,D3
        ADD.W   D6,D3
        SUBQ.W  #1,D3               right = left + size - 1
        MOVE.W  D2,D4
        ADD.W   D6,D4
        SUBQ.W  #1,D4
        MOVEQ   #88,D0              filled ellipse
        TRAP    #15
        MOVE.W  D6,D1
        LSL.W   #3,D1
        MOVE.W  #100,D2
        MOVE.W  D1,D3
        ADD.W   D6,D3
        SUBQ.W  #1,D3
        MOVE.W  D2,D4
        ADD.W   D6,D4
        SUBQ.W  #1,D4
        MOVEQ   #91,D0              unfilled ellipse
        TRAP    #15
        ADDQ.W  #1,D6
        CMP.W   #65,D6
        BLT     SMALL
        MOVE.L  #$000000FF,D1
        MOVEQ   #80,D0
        TRAP    #15
        MOVE.W  #30,D1              a large ellipse
        MOVE.W  #150,D2
        MOVE.W  #610,D3
        MOVE.W  #470,D4
        MOVEQ   #91,D0
        TRAP    #15
        MOVE.W  #100,D1             a tall one
        MOVE.W  #160,D2
        MOVE.W  #160,D3
        MOVE.W  #460,D4
        MOVEQ   #91,D0
        TRAP    #15
* wide pens: widths 2 to 8 on ellipses and on lines
        MOVEQ   #2,D6
WIDE:   MOVE.L  D6,D1
        MOVEQ   #93,D0              pen width
        TRAP    #15
        MOVE.W  D6,D1
        MULU    #60,D1
        ADD.W   #200,D1
        MOVE.W  #180,D2
        MOVE.W  D1,D3
        ADD.W   #50,D3
        MOVE.W  #230,D4
        MOVEQ   #91,D0
        TRAP    #15
        MOVE.W  D6,D1
        MULU    #60,D1
        ADD.W   #200,D1
        MOVE.W  #260,D2
        MOVE.W  D1,D3
        ADD.W   #50,D3
        MOVE.W  #320,D4
        MOVEQ   #84,D0
        TRAP    #15
        ADDQ.W  #1,D6
        CMP.W   #9,D6
        BLT     WIDE
        MOVEQ   #1,D1
        MOVEQ   #93,D0
        TRAP    #15
* shapes that run off the surface
        MOVE.L  #$00FFFFFF,D1
        MOVEQ   #80,D0
        TRAP    #15
        MOVE.W  #-30,D1
        MOVE.W  #-30,D2
        MOVE.W  #50,D3
        MOVE.W  #50,D4
        MOVEQ   #91,D0
        TRAP    #15
        MOVE.W  #600,D1
        MOVE.W  #440,D2
        MOVE.W  #700,D3
        MOVE.W  #520,D4
        MOVEQ   #91,D0
        TRAP    #15
        SIMHALT
        END     START
