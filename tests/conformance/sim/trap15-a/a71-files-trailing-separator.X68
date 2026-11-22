* @item trap15-a 13 Files: names that end in a separator (data\, data/, NUL\, sub\, .\, ...) in tasks 52, 54, 55,
* @item 53, 56, 59, 51, 57: none opens, creates or deletes a file (Windows 11: error 267; Wine the same), with
* @item and without the files data and data.txt before; the device paths \\.\NUL\ and \\?\NUL\ stay
* @item the null device. Dumps the D0.W of each task and whether data and data.txt still exist
* @owner SH6
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVEQ   #1,D7                   ; pass 1: neither file exists; pass 2: both exist
PASS:
    LEA     NAMES,A4
NEXT:
    TST.B   (A4)
    BEQ     ENDPASS
    MOVE.L  A4,A3
SKIP:
    TST.B   (A4)+
    BNE     SKIP
    BSR     SETUP
    MOVE.L  A3,A1
    JSR     DMP_TEXT
    BSR     PROBE
    LEA     RES,A0
    MOVE.L  #32,D0
    JSR     DMP_MEM
    BRA     NEXT
ENDPASS:
    ADDQ.W  #1,D7
    CMP.W   #3,D7
    BNE     PASS
    JSR     DMP_CLOSE
    SIMHALT

* pass 1 (D7 = 1): delete data and data.txt; pass 2: create both
SETUP:
    CMP.W   #1,D7
    BNE     MAKE
    LEA     DATA1,A1
    MOVEQ   #57,D0
    TRAP    #15
    LEA     DATA2,A1
    MOVEQ   #57,D0
    TRAP    #15
    RTS
MAKE:
    LEA     DATA1,A1
    MOVEQ   #52,D0
    TRAP    #15
    MOVEQ   #56,D0
    TRAP    #15
    LEA     DATA2,A1
    MOVEQ   #52,D0
    TRAP    #15
    MOVEQ   #56,D0
    TRAP    #15
    RTS

* A3 = name; the D0.W of tasks 52 (+ 54 55 53 56 when it opened), 59, 51 (+53 55 56), 57, 59, then
* task 59 on data and on data.txt
PROBE:
    LEA     RES,A0
    MOVEQ   #15,D0
PFILL:
    MOVE.W  #$EEEE,(A0)+
    DBRA    D0,PFILL
    LEA     RES,A2
* task 52 (create), then, if it opened: task 54 (write 3), 55 (seek 0), 53 (read 3), 56 (close)
    MOVE.L  A3,A1
    MOVEQ   #52,D0
    TRAP    #15
    MOVE.W  D0,0(A2)
    TST.W   D0
    BNE     P59
    MOVE.L  D1,D6
    MOVE.L  D6,D1
    LEA     ABC,A1
    MOVEQ   #3,D2
    MOVEQ   #54,D0
    TRAP    #15
    MOVE.W  D0,2(A2)
    MOVE.L  D6,D1
    MOVEQ   #0,D2
    MOVEQ   #55,D0
    TRAP    #15
    MOVE.W  D0,4(A2)
    MOVE.L  D6,D1
    LEA     BUF,A1
    MOVEQ   #3,D2
    MOVEQ   #53,D0
    TRAP    #15
    MOVE.W  D0,6(A2)
    MOVE.W  D2,8(A2)
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
    MOVE.W  D0,10(A2)
* task 59: does the file exist
P59:
    MOVE.L  A3,A1
    MOVEQ   #0,D1
    MOVEQ   #59,D0
    TRAP    #15
    MOVE.W  D0,12(A2)
* task 51 (open existing), then, if it opened: task 53 (read 3), 55 (seek 5), 56 (close)
    MOVE.L  A3,A1
    MOVEQ   #51,D0
    TRAP    #15
    MOVE.W  D0,14(A2)
    CMP.W   #2,D0
    BEQ     P57
    MOVE.L  D1,D6
    MOVE.L  D6,D1
    LEA     BUF,A1
    MOVEQ   #3,D2
    MOVEQ   #53,D0
    TRAP    #15
    MOVE.W  D0,16(A2)
    MOVE.W  D2,18(A2)
    MOVE.L  D6,D1
    MOVEQ   #5,D2
    MOVEQ   #55,D0
    TRAP    #15
    MOVE.W  D0,20(A2)
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
    MOVE.W  D0,22(A2)
* task 57 (delete), then task 59 again
P57:
    MOVE.L  A3,A1
    MOVEQ   #57,D0
    TRAP    #15
    MOVE.W  D0,24(A2)
    MOVE.L  A3,A1
    MOVEQ   #59,D0
    TRAP    #15
    MOVE.W  D0,26(A2)
    LEA     DATA1,A1
    MOVEQ   #0,D1
    MOVEQ   #59,D0
    TRAP    #15
    MOVE.W  D0,28(A2)
    LEA     DATA2,A1
    MOVEQ   #59,D0
    TRAP    #15
    MOVE.W  D0,30(A2)
    RTS

ABC     DC.B    'abc'
DATA1   DC.B    'data',0
DATA2   DC.B    'data.txt',0
        DS.W    0
BUF     DS.B    4
RES     DS.W    16
NAMES
        DC.B    'data\',0
        DC.B    'data/',0
        DC.B    'data\\',0
        DC.B    'sub\',0
        DC.B    '.\',0
        DC.B    '..\',0
        DC.B    '\',0
        DC.B    '/',0
        DC.B    'NUL\',0
        DC.B    'NUL/',0
        DC.B    'NUL\\',0
        DC.B    'data.txt\',0
        DC.B    'data.txt/',0
        DC.B    'nul.txt\',0
        DC.B    'data\.',0
        DC.B    'data\..',0
        DC.B    'data\x',0
        DC.B    'data.txt\x',0
        DC.B    '.\data',0
        DC.B    '.\data\',0
        DC.B    'data \',0
        DC.B    'data.\',0
        DC.B    'NUL \',0
        DC.B    'NUL.\',0
        DC.B    '\\.\NUL\',0
        DC.B    'C:\',0
        DC.B    'C:\data\',0
        DC.B    'CON\',0
        DC.B    'COM1\',0
        DC.B    '\\?\NUL\',0
        DC.B    '\\.\NUL/',0
        DC.B    '\\.\NUL\\',0
        DC.B    '\\.\NUL \',0
        DC.B    '\\.\data\',0
        DC.B    'data',0
        DC.B    'data.txt',0
        DC.B    0
        DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START
