* @item trap15-a 4 task 13/14: no length limit (a 600-character string is
* @item printed whole: the cursor column saturates at 255 with wrap off, the
* @item text array is written with stride aliasing)
* @recipe report outlog
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     LONG,A1
    MOVEQ   #14,D0
    TRAP    #15
    JSR     DMP_POS
    MOVEQ   #0,D1
    MOVE.W  #4,D2
    MOVEQ   #2,D3
ROWS:
    JSR     DMP_ROW
    ADDQ.W  #1,D1
    DBRA    D3,ROWS
    MOVEQ   #9,D1
    MOVE.W  #8,D2
    JSR     DMP_ROW
    JSR     DMP_CLOSE
    SIMHALT
LONG DCB.B  200,'1'
     DCB.B  200,'2'
     DCB.B  200,'3'
     DC.B   0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START