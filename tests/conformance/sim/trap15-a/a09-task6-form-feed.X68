* @item trap15-a 13 Text output: task 6 with $0C clears the screen (text array
* @item all spaces, pixels black) and homes the cursor
* @recipe report outlog
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     TEXT,A1
    MOVEQ   #13,D0
    TRAP    #15
    MOVEQ   #13,D0
    TRAP    #15
    MOVEQ   #12,D1
    MOVEQ   #6,D0
    TRAP    #15
    JSR     DMP_POS
    MOVEQ   #0,D1
    MOVE.W  #10,D2
    JSR     DMP_ROW
    MOVEQ   #1,D1
    JSR     DMP_ROW
    MOVEQ   #3,D1
    MOVEQ   #3,D2
    MOVEQ   #83,D0
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
TEXT DC.B   'SOMETHING',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START