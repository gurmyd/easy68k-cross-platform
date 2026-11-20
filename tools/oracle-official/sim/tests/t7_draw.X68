*-----------------------------------------------------------
* t7_draw: graphics output (tasks 80-91) for the screenshot check.
* Draws a red filled rectangle, a green ellipse, blue lines and text,
* then writes a short report so the harness knows drawing finished.
*-----------------------------------------------------------
PROBEN   EQU    7                  ; number of probe points
    ORG     $1000
START:
    LEA     DUMPNAME,A1
    JSR     DMP_OPEN

    MOVE.L  #$000000FF,D1       ; pen red (BGR)
    MOVE.B  #80,D0
    TRAP    #15
    MOVE.L  #$000000FF,D1       ; fill red
    MOVE.B  #81,D0
    TRAP    #15
    MOVE.W  #20,D1
    MOVE.W  #20,D2
    MOVE.W  #220,D3
    MOVE.W  #120,D4
    MOVE.B  #87,D0              ; filled rectangle
    TRAP    #15

    MOVE.L  #$0000FF00,D1       ; green
    MOVE.B  #80,D0
    TRAP    #15
    MOVE.L  #$0000FF00,D1
    MOVE.B  #81,D0
    TRAP    #15
    MOVE.W  #260,D1
    MOVE.W  #20,D2
    MOVE.W  #460,D3
    MOVE.W  #120,D4
    MOVE.B  #88,D0              ; filled ellipse
    TRAP    #15

    MOVE.L  #$00FF0000,D1       ; blue pen
    MOVE.B  #80,D0
    TRAP    #15
    MOVEQ   #0,D5
LINES:
    MOVE.W  #20,D1
    MOVE.W  #150,D2
    MOVE.W  #460,D3
    MOVE.W  #150,D4
    ADD.W   D5,D4
    MOVE.B  #84,D0              ; line
    TRAP    #15
    ADD.W   #10,D5
    CMP.W   #100,D5
    BLE     LINES

    MOVE.W  #20,D1
    MOVE.W  #270,D2
    LEA     TEXT,A1
    MOVE.B  #95,D0              ; draw text
    TRAP    #15

    MOVE.B  #94,D0              ; repaint: copy the back buffer to the window
    TRAP    #15                 ; (without it Wine's window misses drawing, see doc)

    LEA     PROBES,A2           ; read back pixels with task 83
    LEA     PIXELS,A3
    MOVEQ   #PROBEN-1,D6
PROBE:
    MOVE.W  (A2)+,D1
    MOVE.W  (A2)+,D2
    MOVE.B  #83,D0              ; D0.L = $00BBGGRR, or -1 off the surface
    TRAP    #15
    MOVE.L  D0,(A3)+
    DBRA    D6,PROBE
    JSR     DMP_REGS
    LEA     PROBES,A0           ; dump (x,y) words followed by the colours
    MOVE.L  #PROBEN*8,D0
    JSR     DMP_MEM
    JSR     DMP_CLOSE
    SIMHALT

DUMPNAME DC.B   't7_draw_dump.txt',0
TEXT     DC.B   'EASy68K graphics',0
    DS.W    0
* probe points: inside rectangle, inside ellipse, middle of first line,
* middle and end of last line, inside the text, background
PROBES   DC.W   100,75, 360,70, 240,150, 240,200, 460,250, 24,278, 600,400
PIXELS   DS.L   PROBEN
    DS.W    0
    INCLUDE 'dumplib.X68'
    END     START
