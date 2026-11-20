*-----------------------------------------------------------
* Title      : Toolchain smoke test
* Written by : EASy68K macOS port team
* Description: Small but varied program. It is assembled by the native
*              oracle (asy68k.exe) and by the WebAssembly build of the
*              same sources, and the .L68 / .S68 outputs are compared.
*-----------------------------------------------------------
CR      EQU     $0D
LF      EQU     $0A
COUNT   EQU     5                   number of FOR iterations
STACK   EQU     $8000
SQUARE  EQU     COUNT*COUNT+(STACK>>12)

* print the string at \1 with TRAP #15 task \2
PRINT   MACRO
        LEA     \1,A1
        MOVE.B  #\2,D0
        TRAP    #15
        ENDM

        ORG     $1000
START:                              ; first instruction of program
        LEA     STACK,SP
        MOVEM.L D0-D7/A0-A6,-(SP)   save everything
        PRINT   HELLO,14
        PRINT   MSG2,13

        CLR.L   D2
        FOR.W   D1 = #1 TO #COUNT DO
            ADD.W   D1,D2
        ENDF

        IF.W D2 <EQ> #15 THEN
            LEA     OKMSG,A1
        ELSE
            LEA     BADMSG,A1
        ENDI
        MOVE.B  #13,D0
        TRAP    #15

        MOVEQ   #3,D3
LOOP    SUBQ.W  #1,D3               backward branch target
        BEQ.S   DONE                forward short branch
        BSR     DOUBLE              forward subroutine call
        BRA     LOOP                backward branch
DONE    WHILE.B D3 <LT> #4 DO
            ADDQ.B  #1,D3
        ENDW
        REPEAT
            LSR.L   #1,D2
        UNTIL.L D2 <LS> #SQUARE DO
	MOVEM.L	(SP)+,D0-D7/A0-A6	tab-separated line
        MOVEM.W D0/D2/A1,BUFFER
        MOVE.L  D2,RESULT
        SIMHALT

DOUBLE  ADD.L   D2,D2
        DBRA    D4,DOUBLE           backward DBcc
        RTS

        ORG     $2000
HELLO   DC.B    'Hello, 68000!',CR,LF,0
MSG2    DC.B    'It''s a "quoted" string',0
OKMSG   DC.B    'sum ok',0
BADMSG  DC.B    'sum bad',0
WORDS   DC.W    1,$2,%11,@4,'AB',-1,SQUARE
LONGS   DC.L    $DEADBEEF,START,'ABCD',COUNT*4+1,DONE-LOOP
BUFFER  DS.B    15
RESULT  DS.L    1
TABLE   DCB.W   4,$FFFF
        END     START
