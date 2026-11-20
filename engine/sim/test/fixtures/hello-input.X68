*-----------------------------------------------------------
* Title      : hello-input - asks for a name and greets
* Written by : easy68k-mac project (test fixture, GPL-2.0-or-later)
* Description: The smallest program with keyboard input; used by the
*              tests of the command-line runner (test/api.test.mjs).
*-----------------------------------------------------------
        ORG     $1000
START:  LEA     PROMPT,A1
        MOVEQ   #14,D0
        TRAP    #15             print the prompt
        LEA     NAME,A1
        MOVEQ   #2,D0
        TRAP    #15             read a line
        LEA     HELLO,A1
        MOVEQ   #14,D0
        TRAP    #15
        LEA     NAME,A1
        MOVEQ   #13,D0
        TRAP    #15             print the name and a line end
        SIMHALT

PROMPT  DC.B    'Name? ',0
HELLO   DC.B    'Hello, ',0
NAME    DS.B    80

        END     START
