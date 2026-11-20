*-----------------------------------------------------------
* Title      : debug - a small program for the debugger tests
* Written by : easy68k-mac project (test fixture, GPL-2.0-or-later)
* Description: Used by test/debug.test.mjs for PC breakpoints, the
*              listing directives, advanced breakpoints, Step Over,
*              Run To Cursor, Trace Into and the execution log.
*              The binary constant in the source (#%1010) is on purpose:
*              the original prints listing lines with fprintf.
*-----------------------------------------------------------
        ORG     $1000
START:  MOVEQ   #0,D0
        MOVEQ   #3,D1
LOOP    ADDQ.L  #1,D0
        BSR     SUB
        MOVE.L  D0,COUNT
        SUBQ.L  #1,D1
        BNE.S   LOOP
        MOVE.B  #%1010,D2
        JSR     SUB
*[sim68k]break
        MOVE.W  VALUE,D3
        NOP
        SIMHALT

SUB     ADDQ.L  #1,D5
        ADDQ.L  #1,D5
        RTS

        ORG     $2000
COUNT   DC.L    0
VALUE   DC.W    $1234

        END     START
