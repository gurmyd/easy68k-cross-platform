* @item trap15-b 5.6 / 7 task 94 (repaint) with double buffering off and on:
* @item no register changes (D0-D2 hold values of their own), the pen position
* @item that task 96 reports before and after it (task 94 copies the picture,
* @item not the pen position; mode 16 copies the pen position), and the
* @item colour of a flat area drawn in the back buffer read back with task 83
* @owner SH1
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVE.L  #$000000FF,D1
    MOVEQ   #80,D0              ; pen colour
    TRAP    #15
    MOVEQ   #81,D0              ; fill colour
    TRAP    #15
    MOVE.W  #10,D1
    MOVE.W  #12,D2
    MOVEQ   #86,D0              ; move to (10,12)
    TRAP    #15
* task 94 with buffering off
    MOVE.L  #$11112222,D1
    MOVE.L  #$33334444,D2
    MOVE.L  #$ABCD005E,D0       ; task 94
    TRAP    #15
    JSR     DMP_REGS
    MOVEQ   #96,D0
    TRAP    #15
    JSR     DMP_REGS
* buffering on: draw in the back buffer
    MOVEQ   #17,D1
    MOVEQ   #92,D0
    TRAP    #15
    MOVE.W  #40,D1
    MOVE.W  #50,D2
    MOVE.W  #80,D3
    MOVE.W  #70,D4
    MOVEQ   #87,D0              ; filled rectangle
    TRAP    #15
    MOVE.W  #100,D1
    MOVE.W  #60,D2
    MOVEQ   #86,D0              ; move to (100,60)
    TRAP    #15
    MOVEQ   #96,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  #$55556666,D1
    MOVE.L  #$77778888,D2
    MOVE.L  #$ABCD005E,D0       ; task 94
    TRAP    #15
    JSR     DMP_REGS
    MOVEQ   #96,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.W  #60,D1
    MOVE.W  #60,D2
    MOVEQ   #83,D0              ; get pixel inside the rectangle
    TRAP    #15
    JSR     DMP_REGS
* buffering off again (mode 16), then task 94
    MOVEQ   #16,D1
    MOVEQ   #92,D0
    TRAP    #15
    MOVEQ   #96,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  #$ABCD005E,D0       ; task 94
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START
