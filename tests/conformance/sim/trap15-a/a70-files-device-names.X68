* @item trap15-a 13 Files: Windows device names in the file tasks. For each name the program
* @item runs task 52 (create), 54 (write 3 bytes), 55 (seek 0), 53 (read 3), 56 (close), 59,
* @item 51 (open existing), 53, 55 (seek 5), 56, 57 (delete) and 59 again, and dumps the D0.W
* @item of each (and D2.W of the reads): the names NUL in its spellings and behind a folder part
* @item are the null device; names near it are ordinary files. Only names on which Windows 11
* @item (measured) and the official program under Wine agree are in the list; a58 pins NUL itself
* @item with D1 and the registers
* @owner SH6
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     NAMES,A4
NEXT:
    TST.B   (A4)
    BEQ     DONE
    MOVE.L  A4,A3                   ; the name
SKIP:
    TST.B   (A4)+
    BNE     SKIP
    MOVE.L  A3,A1
    JSR     DMP_TEXT
    BSR     PROBE
    LEA     RES,A0
    MOVE.L  #28,D0
    JSR     DMP_MEM
    BRA     NEXT
DONE:
    JSR     DMP_CLOSE
    SIMHALT

* A3 = name; the D0.W of each task goes to RES ($EEEE = not done)
PROBE:
    LEA     RES,A0
    MOVEQ   #13,D0
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
    RTS

ABC     DC.B    'abc'
        DS.W    0
BUF     DS.B    4
RES     DS.W    14
* The names, each ended by a zero byte; the list ends with an empty name.
NAMES
* the null device, in every spelling Windows 11 and Wine both read as NUL: any case, trailing spaces, periods and colons
        DC.B    'NUL',0
        DC.B    'nul',0
        DC.B    'nUl',0
        DC.B    'NUL ',0
        DC.B    'NUL.',0
        DC.B    'NUL..',0
        DC.B    'NUL:',0
        DC.B    'NUL :',0
        DC.B    'NUL::',0
        DC.B    'NUL :.',0
        DC.B    'NUL. .',0
* the null device behind a folder part (the folders "." and ".." and the root, a drive letter, a path that goes up again, the device paths)
        DC.B    '.\NUL',0
        DC.B    './nul',0
        DC.B    '..\NUL',0
        DC.B    'nofolder\..\NUL',0
        DC.B    '\NUL',0
        DC.B    '/NUL',0
        DC.B    'C:\NUL',0
        DC.B    'C:NUL',0
        DC.B    'C:\Windows\NUL',0
        DC.B    '\\.\NUL',0
        DC.B    '\\.\nul',0
        DC.B    '\\?\NUL',0
* names near NUL that are ordinary files (the file is created, written, read, closed and deleted again)
        DC.B    'NULL',0
        DC.B    'NUL1',0
        DC.B    'NULx',0
        DC.B    ' NUL',0
        DC.B    'NUL\.',0
* device names that are only a device as a whole name (COM0, COM10, LPT0, CLOCK$) are ordinary files
        DC.B    'COM0',0
        DC.B    'COM10',0
        DC.B    'LPT0',0
        DC.B    'CLOCK$',0
* a name that fails to open in both programs (\\.\NUL.txt: a device path with an extension)
        DC.B    '\\.\NUL.txt',0
        DC.B    0
        DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START
