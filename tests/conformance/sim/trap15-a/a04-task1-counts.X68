* @item trap15-a 13 Text output: task 1 is task 0 without CR LF: D1.W = 3, 300,
* @item 5 with an embedded NUL and 0; the cursor stays after the text
* @recipe report outlog
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     ABCDE,A1
    MOVE.W  #3,D1
    MOVEQ   #1,D0
    TRAP    #15
    JSR     DMP_POS
    LEA     ABNUL,A1
    MOVE.W  #5,D1
    MOVEQ   #1,D0
    TRAP    #15
    JSR     DMP_POS
    LEA     ABCDE,A1
    MOVEQ   #0,D1
    MOVEQ   #1,D0
    TRAP    #15
    JSR     DMP_POS
    LEA     LONG,A1
    MOVE.W  #300,D1
    MOVEQ   #1,D0
    TRAP    #15
    JSR     DMP_POS
    JSR     DMP_REGS
    MOVEQ   #0,D1
    MOVE.W  #10,D2
    JSR     DMP_ROW
    JSR     DMP_CLOSE
    SIMHALT
ABCDE DC.B  'ABCDE',0
ABNUL DC.B  'AB',0,'CD',0
LONG  DCB.B 299,'b'
      DC.B  'y',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START