* @item trap15-a 13 Text output: task 0 with D1.W = 3 and 'ABCDE' displays ABC
* @item then CR LF; with D1.W = 300 and a 300-character text 255 characters;
* @item with D1.W = 5 and 'AB',0,'CD' only AB; D1.W = 0 only the CR LF
* @recipe report outlog
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     ABCDE,A1
    MOVE.W  #3,D1
    MOVEQ   #0,D0
    TRAP    #15
    JSR     DMP_POS
    LEA     LONG,A1
    MOVE.W  #300,D1
    MOVEQ   #0,D0
    TRAP    #15
    JSR     DMP_POS
    LEA     ABNUL,A1
    MOVE.W  #5,D1
    MOVEQ   #0,D0
    TRAP    #15
    JSR     DMP_POS
    LEA     ABCDE,A1
    MOVE.L  #$FFFF0000,D1
    MOVEQ   #0,D0
    TRAP    #15
    JSR     DMP_POS
    JSR     DMP_REGS
    MOVEQ   #0,D1
    MOVE.W  #20,D2
    JSR     DMP_ROW
    MOVEQ   #1,D1
    MOVE.W  #60,D2
    JSR     DMP_ROW
    JSR     DMP_CLOSE
    SIMHALT
ABCDE DC.B  'ABCDE',0
ABNUL DC.B  'AB',0,'CD',0
LONG  DCB.B 299,'a'
      DC.B  'z',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START