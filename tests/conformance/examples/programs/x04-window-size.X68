*-----------------------------------------------------------
* Title      : x04-window-size
* Purpose    : whole-program pixel regression (X3): task 33 sets the output window to 800 x 600
*              (the surface is cleared and resized), then pictures are drawn across the old
*              640 x 480 edge, with text.
*-----------------------------------------------------------
        ORG     $1000
START:
        LEA     BEFORE,A1
        MOVEQ   #14,D0
        TRAP    #15
        MOVE.L  #$03200258,D1           800 x 600
        MOVEQ   #33,D0
        TRAP    #15
        MOVE.L  #$00FFFFFF,D1
        MOVEQ   #80,D0
        TRAP    #15
        MOVE.L  #$00804020,D1
        MOVEQ   #81,D0
        TRAP    #15
        MOVE.W  #600,D1                 beyond the old right edge
        MOVE.W  #400,D2
        MOVE.W  #790,D3
        MOVE.W  #590,D4
        MOVEQ   #88,D0
        TRAP    #15
        MOVEQ   #0,D6
STRIPES:
        MOVE.L  D6,D1
        MULU    #$0305,D1
        MOVEQ   #80,D0
        TRAP    #15
        MOVE.W  #0,D1
        MOVE.W  D6,D2
        LSL.W   #3,D2
        MOVE.W  #799,D3
        MOVE.W  D2,D4
        ADD.W   #40,D4
        MOVEQ   #84,D0
        TRAP    #15
        ADDQ.W  #1,D6
        CMP.W   #75,D6
        BLT     STRIPES
        LEA     AFTER,A1
        MOVEQ   #14,D0
        TRAP    #15
        SIMHALT
BEFORE: DC.B    'Before the resize',0
AFTER:  DC.B    'After: 800 x 600',0
        END     START
