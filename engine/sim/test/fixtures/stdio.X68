*-----------------------------------------------------------
* Title      : stdio - the Borland run-time's file streams (tasks 50-59)
* Written by : easy68k-mac project (test fixture, GPL-2.0-or-later)
* Description: The test puts a case number in D7 and runs.  Case n is the
*              code at $2000 + n*$100.  D0.W and D2.L after each task are
*              stored with (A6)+ in RESULTS (word, long).
*              test/stdio.test.mjs asserts; shim/STDIO-MODEL.md has the
*              rules (R1-R13) the cases check.
*-----------------------------------------------------------
T15     MACRO                   TRAP #15 task \1, then D0.W and D2.L to (A6)+
        MOVEQ   #\1,D0
        TRAP    #15
        MOVE.W  D0,(A6)+
        MOVE.L  D2,(A6)+
        ENDM

        ORG     $1000
START:  LEA     RESULTS,A6
        LSL.W   #8,D7
        LEA     $2000,A0
        JMP     0(A0,D7.W)

        ORG     $2000           case 0: a read right after a write (R3, R6)
        LEA     NAME,A1
        T15     52              new
        MOVE.L  D1,D6
        LEA     ABC,A1
        MOVEQ   #5,D2
        T15     54              write ABCDE
        MOVE.L  D6,D1
        LEA     BUF,A1
        MOVEQ   #4,D2
        T15     53              read 4: from the buffer, D2 = 4
        MOVE.L  D6,D1
        T15     56              close: the flush writes 1 byte
        SIMHALT

        ORG     $2100           case 1: a write right after a read (R8)
        LEA     NAME,A1
        T15     52
        MOVE.L  D1,D6
        LEA     ABC,A1
        MOVEQ   #5,D2
        T15     54              write ABCDE
        MOVE.L  D6,D1
        MOVEQ   #1,D2
        T15     55              seek 1
        MOVE.L  D6,D1
        LEA     BUF,A1
        MOVEQ   #2,D2
        T15     53              read 2 (BC)
        MOVE.L  D6,D1
        LEA     XYZ,A1
        MOVEQ   #1,D2
        T15     54              write X: into the read buffer only
        MOVE.L  D6,D1
        T15     56
        SIMHALT

        ORG     $2200           case 2: a flush that fails (R6, R12)
        LEA     NAME,A1
        T15     52
        MOVE.L  D1,D6
        LEA     ABC,A1
        MOVEQ   #5,D2
        T15     54              write ABCDE
        MOVE.L  D6,D1
        MOVEQ   #25,D2
        T15     55              seek 25: ABCDE is written
        MOVE.L  D6,D1
        LEA     XYZ,A1
        MOVEQ   #1,D2
        T15     54              write X
        MOVE.L  D6,D1
        LEA     BUF,A1
        MOVEQ   #4,D2
        T15     53              read 4: the flush would now write -3 bytes
        MOVE.L  D6,D1
        T15     56              close fails: D0.W = 2, the handle stays open
        LEA     NAME,A1
        T15     57              delete fails: the file is open
        SIMHALT

        ORG     $2300           case 3: the error flag (R5, R11)
        LEA     NAME,A1
        T15     52
        MOVE.L  D1,D6
        LEA     BIG,A1
        MOVE.L  #600,D2
        T15     54              600 bytes: written at once
        MOVE.L  D6,D1
        LEA     ABC,A1
        MOVEQ   #5,D2
        T15     54              5 bytes into the buffer
        MOVE.L  D6,D1
        LEA     BUF,A1
        MOVEQ   #7,D2
        T15     53              read 7 in the write state
        MOVE.L  D6,D1
        MOVEQ   #0,D2
        T15     55              seek: the flush fails, D0.W = 2
        MOVE.L  D6,D1
        MOVEQ   #0,D2
        T15     55              seek again: 0
        MOVE.L  D6,D1
        LEA     BUF,A1
        MOVEQ   #3,D2
        T15     53              read 3: the error flag stays, D0.W = 2
        MOVE.L  D6,D1
        LEA     BUF,A1
        MOVE.L  #600,D2
        T15     53              read 600: 512 straight from the file, D2 = 512
        MOVE.L  D6,D1
        T15     56              close: 0
        SIMHALT

        ORG     $2400           case 4: a write after a read that emptied the buffer (R10)
        LEA     DATA,A1
        T15     51              open the 300-byte file
        MOVE.L  D1,D6
        LEA     BUF,A1
        MOVEQ   #100,D2
        T15     53
        MOVE.L  D6,D1
        LEA     BUF,A1
        MOVE.L  #200,D2
        T15     53              all 300 read: level 0, curp at 300
        MOVE.L  D6,D1
        LEA     XYZ,A1
        MOVEQ   #2,D2
        T15     54              write XY at curp; the flush writes buffer[0..2)
        MOVE.L  D6,D1
        T15     56
        SIMHALT

        ORG     $2500           case 5: streams whose close failed are never freed (section 8)
        MOVEQ   #60,D5
LEAK:   LEA     NAME,A1
        MOVEQ   #52,D0
        TRAP    #15
        TST.W   D0
        BNE.S   FULL
        MOVE.L  D1,D6
        LEA     ABC,A1
        MOVEQ   #5,D2
        MOVEQ   #54,D0
        TRAP    #15
        MOVE.L  D6,D1
        LEA     BUF,A1
        MOVEQ   #7,D2
        MOVEQ   #53,D0
        TRAP    #15
        MOVE.L  D6,D1
        MOVEQ   #56,D0
        TRAP    #15
        ADDQ.B  #1,NAME+1
        SUBQ.W  #1,D5
        BNE     LEAK
FULL:   MOVE.W  D5,(A6)+        60 - number of streams that were opened
        SIMHALT

        ORG     $2600           case 6: a stream a Rewind forgets (R13; probe e2)
        LEA     NAME,A1
        T15     51              second run: the file exists
        TST.W   D0
        BEQ.S   SECOND
        LEA     NAME,A1
        T15     52              first run: create, write ABCDE, never close
        LEA     ABC,A1
        MOVEQ   #5,D2
        T15     54
        SIMHALT
SECOND: MOVE.L  D1,D6
        LEA     BUF,A1
        MOVEQ   #10,D2
        T15     53              the bytes are still in the forgotten buffer: end of file
        MOVE.L  D6,D1
        T15     56
        LEA     NAME,A1
        T15     57              the forgotten stream keeps the file open: 2
        SIMHALT

        ORG     $2700           case 7: a write in the read state 10 bytes past the buffer (section 7; p10a)
        LEA     DATA,A1
        T15     51
        MOVE.L  D1,D6
        LEA     BUF,A1
        MOVEQ   #10,D2
        T15     53
        MOVE.L  D6,D1
        LEA     BIG,A1
        MOVE.L  #512,D2
        T15     54              into the buffer at 10: 10 bytes past its end
        MOVE.L  D6,D1
        T15     56              the release of the buffer: access violation
        LEA     NAME,A1
        T15     52              (after Run again) the next allocation fails too
        SIMHALT

NAME    DC.B    'xA.bin',0
DATA    DC.B    'in.bin',0
ABC     DC.B    'ABCDE'
XYZ     DC.B    'XYZ'
        DS.W    0
BUF     DS.B    1024
BIG     DCB.B   600,'z'
        ORG     $8000
RESULTS DS.B    256
        END     START
