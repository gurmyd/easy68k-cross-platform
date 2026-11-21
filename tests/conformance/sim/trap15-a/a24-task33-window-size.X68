* @item trap15-a 13 Timing and environment: task 33 D1 = 0 gives $028001E0;
* @item $03200258 sets 800x600 (then D1 = 0 gives $03200258), blacks the
* @item screen, keeps the cursor and the text array; $00640064 gives 640x480
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     TEXT,A1
    MOVEQ   #14,D0
    TRAP    #15
    MOVEQ   #0,D1
    MOVEQ   #33,D0
    TRAP    #15
    LEA     SIZE,A1
    JSR     DMP_VAL
    MOVE.L  #$03200258,D1
    MOVEQ   #33,D0
    TRAP    #15
    LEA     AFTER,A1
    JSR     DMP_VAL
    MOVEQ   #0,D1
    MOVEQ   #33,D0
    TRAP    #15
    LEA     SIZE,A1
    JSR     DMP_VAL
    JSR     DMP_POS
    MOVEQ   #0,D1
    MOVE.W  #8,D2
    JSR     DMP_ROW
    MOVE.W  #4,D1
    MOVE.W  #4,D2
    MOVEQ   #83,D0
    TRAP    #15
    LEA     PIXEL,A1
    MOVE.L  D0,D1
    JSR     DMP_VAL
    MOVE.L  #$00640064,D1
    MOVEQ   #33,D0
    TRAP    #15
    MOVEQ   #0,D1
    MOVEQ   #33,D0
    TRAP    #15
    LEA     SIZE,A1
    JSR     DMP_VAL
    JSR     DMP_CLOSE
    SIMHALT
TEXT  DC.B  'TEXT',0
SIZE  DC.B  'size',0
AFTER DC.B  'after',0
PIXEL DC.B  'pixel',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START