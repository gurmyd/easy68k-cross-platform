*-----------------------------------------------------------------------------
* surface.X68 - the largest output surface: resize, clear, flood fill
*
* Part of easy68k-mac (GPL-2.0-or-later). Owner: work package P1
* (docs/ARCHITECTURE.md 3.4, 9.6; docs/porting/speed.md).
*
* Sets the output window to 4096 x 4096 pixels (TRAP #15 task 33; the port's
* MAX_SURFACE), clears it (task 11), and flood-fills it from the centre in
* green (task 89), which paints every one of its 16,777,216 pixels. Then it
* reads two corner pixels back (task 83) and the size (task 33), and halts.
* The Output panel presents the result once per display frame.
*
* Results, when it halts (times in hundredths of a second, by task 8):
*   D3 = the size task 33 reports ($10001000 = 4096 x 4096)
*   D7 = time before the resize, D6 = after it, D5 = after the clear,
*   D4 = after the flood fill
*   A2 = the pixel at (4095,4095), A3 = the pixel at (0,0): both $0000C000
*-----------------------------------------------------------------------------

GREEN   EQU     $0000C000               ; $00BBGGRR

        ORG     $1000
START:  MOVEQ   #8,D0
        TRAP    #15
        MOVE.L  D1,D7                   ; before the resize
        MOVE.L  #$10001000,D1           ; width 4096 (high word), height 4096
        MOVEQ   #33,D0
        TRAP    #15
        MOVEQ   #8,D0
        TRAP    #15
        MOVE.L  D1,D6                   ; after the resize
        MOVE.W  #$FF00,D1
        MOVEQ   #11,D0                  ; clear the screen
        TRAP    #15
        MOVEQ   #8,D0
        TRAP    #15
        MOVE.L  D1,D5                   ; after the clear
        MOVE.L  #GREEN,D1
        MOVEQ   #81,D0                  ; fill colour
        TRAP    #15
        MOVE.W  #2048,D1
        MOVE.W  #2048,D2
        MOVEQ   #89,D0                  ; flood fill from the centre
        TRAP    #15
        MOVEQ   #8,D0
        TRAP    #15
        MOVE.L  D1,D4                   ; after the flood fill
        MOVE.W  #4095,D1
        MOVE.W  #4095,D2
        MOVEQ   #83,D0                  ; pixel at the far corner
        TRAP    #15
        MOVEA.L D0,A2
        MOVEQ   #0,D1
        MOVEQ   #0,D2
        MOVEQ   #83,D0                  ; pixel at the near corner
        TRAP    #15
        MOVEA.L D0,A3
        MOVEQ   #0,D1
        MOVEQ   #33,D0                  ; the size
        TRAP    #15
        MOVE.L  D1,D3
        SIMHALT

        END     START
