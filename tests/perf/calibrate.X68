*-----------------------------------------------------------------------------
* calibrate.X68 - instructions per second, by the program's own clock
*
* Part of easy68k-mac (GPL-2.0-or-later). Owner: work package P1
* (docs/ARCHITECTURE.md 4.5.6, decision O-1; docs/porting/speed.md).
*
* Runs a counted loop for at least ten seconds of the time of day that
* TRAP #15 task 8 reports, then shows how many instructions it executed, how
* many hundredths of a second that took, and the quotient: the simulator's
* instructions per second. Load it into EASy68K (the original SIM68K.exe or
* the port), press Run (F9) and wait about ten seconds.
*
* What it measures. Every instruction of the loop is counted, the TRAP #15
* that reads the clock included (one instruction, as the simulator counts
* it), so the figure is the rate at which the simulator executes this
* program: one instruction, then the original's message pumps, then the next.
* Keep the window still while it runs: moving or covering windows slows the
* original down. The time is the PC's wall clock in hundredths, so the
* figure is exact to about 0.2 percent.
*
* Results, when it halts:
*   - the Output window shows three lines, for example
*       instructions executed: 10001800
*       hundredths of a second: 1000
*       instructions per second: 1000180
*   - registers: D4 = instructions executed, D3 = hundredths of a second,
*     D7 = instructions per second (each unsigned, 32 bits);
*   - the same three lines in the file result.bin in the program's folder,
*     followed by the line END-OF-DUMP (the form in which the Wine oracle of
*     tests/oracle/wine/sim collects a program's results).
*
* Every block of the loop executes PERBLK instructions: BLOCK times the two
* of the inner loop and the nine around it. A run that passes midnight
* executes one uncounted instruction (the correction of the clock).
*-----------------------------------------------------------------------------

BLOCK   EQU     25000                   ; inner iterations per block
PERBLK  EQU     2*BLOCK+9               ; instructions per block, all counted
MINTIME EQU     1000                    ; hundredths of a second to run at least
DAY     EQU     8640000                 ; hundredths in a day (task 8 wraps)

        ORG     $1000
START:  MOVEQ   #8,D0                   ; time of day in hundredths -> D1
        TRAP    #15
        MOVE.L  D1,D6                   ; D6 = start time
        MOVEQ   #0,D4                   ; D4 = instructions counted

OUTER:  MOVE.L  #BLOCK,D2               ; 1
INNER:  SUBQ.L  #1,D2                   ; BLOCK times
        BNE.S   INNER                   ; BLOCK times
        ADD.L   #PERBLK,D4              ; 2
        MOVEQ   #8,D0                   ; 3
        TRAP    #15                     ; 4
        MOVE.L  D1,D3                   ; 5
        SUB.L   D6,D3                   ; 6  D3 = hundredths since the start
        BPL.S   NOWRAP                  ; 7
        ADD.L   #DAY,D3                 ;    past midnight (not counted)
NOWRAP: CMP.L   #MINTIME,D3             ; 8
        BLO.S   OUTER                   ; 9

* D7 = D4 * 100 / D3 without overflow: (D4 / D3) * 100 + (D4 mod D3) * 100 / D3
        MOVE.L  D4,D0
        MOVE.L  D3,D1
        BSR     DIVU32                  ; D0 = quotient, D1 = remainder
        MOVE.L  D0,D7
        BSR     MUL100D7                ; D7 = quotient * 100
        MOVE.L  D1,D0
        BSR     MUL100D0                ; D0 = remainder * 100
        MOVE.L  D3,D1
        BSR     DIVU32
        ADD.L   D0,D7                   ; D7 = instructions per second

* show the three lines and write them to result.bin
        LEA     FNAME,A1
        MOVE.L  #52,D0                  ; open a new file
        TRAP    #15
        MOVE.L  D1,FID
        LEA     TXT1,A1
        MOVE.L  D4,D1
        BSR     REPORT
        LEA     TXT2,A1
        MOVE.L  D3,D1
        BSR     REPORT
        LEA     TXT3,A1
        MOVE.L  D7,D1
        BSR     REPORT
        LEA     ENDTXT,A1
        BSR     PUTSTR
        BSR     PUTLINE
        MOVE.L  FID,D1
        MOVE.L  #56,D0                  ; close the file
        TRAP    #15
        SIMHALT

*--- subroutines -------------------------------------------------------------

* DIVU32: D0 = D0 / D1, D1 = D0 mod D1 (unsigned, 32 bits, D1 not 0).
* Uses D2 and D5; keeps every other register.
DIVU32: MOVEM.L D2/D5/D6,-(SP)
        MOVE.L  D1,D6                   ; divisor
        MOVEQ   #0,D5                   ; remainder
        MOVEQ   #31,D2
DIVLP:  LSL.L   #1,D0                   ; next dividend bit into X
        ROXL.L  #1,D5                   ; ... and into the remainder
        CMP.L   D6,D5
        BLO.S   DIVNX
        SUB.L   D6,D5
        ADDQ.L  #1,D0                   ; quotient bit (the shift freed bit 0)
DIVNX:  DBRA    D2,DIVLP
        MOVE.L  D5,D1
        MOVEM.L (SP)+,D2/D5/D6
        RTS

* MUL100D7: D7 = D7 * 100 (64 + 32 + 4). MUL100D0: D0 = D0 * 100.
MUL100D7:
        MOVE.L  D0,-(SP)
        MOVE.L  D7,D0
        BSR     MUL100D0
        MOVE.L  D0,D7
        MOVE.L  (SP)+,D0
        RTS
MUL100D0:
        MOVEM.L D1/D2,-(SP)
        LSL.L   #2,D0                   ; D0 = x * 4
        MOVE.L  D0,D1
        LSL.L   #3,D1                   ; D1 = x * 32
        MOVE.L  D1,D2
        ADD.L   D1,D2                   ; D2 = x * 64
        ADD.L   D1,D0
        ADD.L   D2,D0
        MOVEM.L (SP)+,D1/D2
        RTS

* REPORT: shows the text at A1 and D1.L in decimal on one line, and appends
* the same line to result.bin. Keeps every register.
REPORT: MOVEM.L D0-D2/A1,-(SP)
        MOVE.L  D1,-(SP)
        MOVEQ   #17,D0                  ; text at (A1), then D1.L in decimal
        TRAP    #15
        LEA     EMPTY,A1
        MOVEQ   #13,D0                  ; an empty text and CR LF: ends the line
        TRAP    #15
        MOVE.L  (SP)+,D1
        MOVE.L  12(SP),A1               ; the text again (saved A1)
        BSR     PUTSTR
        MOVE.L  D1,D0
        BSR     PUTDEC
        BSR     PUTLINE
        MOVEM.L (SP)+,D0-D2/A1
        RTS

* PUTSTR: appends the NUL-terminated text at A1 to the line buffer.
PUTSTR: MOVEM.L A1/A2,-(SP)
        MOVEA.L BUFPTR,A2
PUTSLP: MOVE.B  (A1)+,(A2)+
        BNE.S   PUTSLP
        SUBQ.L  #1,A2                   ; back onto the NUL
        MOVE.L  A2,BUFPTR
        MOVEM.L (SP)+,A1/A2
        RTS

* PUTDEC: appends D0.L (unsigned) in decimal to the line buffer.
PUTDEC: MOVEM.L D0-D2/A1/A2,-(SP)
        LEA     DIGEND,A1               ; digits are made backwards
PUTDLP: MOVEQ   #10,D1
        BSR     DIVU32                  ; D0 = D0 / 10, D1 = digit
        ADD.B   #'0',D1
        MOVE.B  D1,-(A1)
        TST.L   D0
        BNE.S   PUTDLP
        MOVEA.L BUFPTR,A2
PUTDCP: MOVE.B  (A1)+,(A2)+
        CMPA.L  #DIGEND,A1
        BNE.S   PUTDCP
        MOVE.L  A2,BUFPTR
        MOVEM.L (SP)+,D0-D2/A1/A2
        RTS

* PUTLINE: appends CR LF and writes the line buffer to result.bin.
PUTLINE:
        MOVEM.L D0-D2/A1/A2,-(SP)
        MOVEA.L BUFPTR,A2
        MOVE.B  #13,(A2)+
        MOVE.B  #10,(A2)+
        LEA     BUF,A1
        MOVE.L  A2,D2
        SUB.L   A1,D2                   ; length
        MOVE.L  FID,D1
        MOVE.L  #54,D0                  ; write to the file
        TRAP    #15
        MOVE.L  #BUF,BUFPTR
        MOVEM.L (SP)+,D0-D2/A1/A2
        RTS

*--- data --------------------------------------------------------------------

TXT1    DC.B    'instructions executed: ',0
TXT2    DC.B    'hundredths of a second: ',0
TXT3    DC.B    'instructions per second: ',0
ENDTXT  DC.B    'END-OF-DUMP',0
FNAME   DC.B    'result.bin',0
EMPTY   DC.B    0
        DS.W    0
FID     DC.L    0
BUFPTR  DC.L    BUF
DIGITS  DS.B    10
DIGEND  DS.B    0
        DS.W    0
BUF     DS.B    80

        END     START
