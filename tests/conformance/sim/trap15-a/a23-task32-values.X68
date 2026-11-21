* @item trap15-a 13 Timing and environment: task 32 D1.B = 4 gives $00051001;
* @item 1, 2, 3, 7 give $00E00000, $00E00010, $00E00012, $00E00014; an unknown
* @item sub-task (8) changes nothing; only D1.B counts
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     SUBS,A2
LOOP:
    MOVE.L  (A2)+,D1
    CMP.L   #-1,D1
    BEQ     DONE
    MOVEQ   #32,D0
    TRAP    #15
    LEA     GOT,A1
    JSR     DMP_VAL
    BRA     LOOP
DONE:
    JSR     DMP_CLOSE
    SIMHALT
SUBS DC.L   4,1,2,3,7,8,$12345601,$FFFFFF04,-1
GOT  DC.B   'D1',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START