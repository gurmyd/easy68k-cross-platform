*-----------------------------------------------------------------------------
* dumplib.X68 - self-report routines for the simulator conformance programs
*
* Part of easy68k-mac (GPL-2.0-or-later). The official SIM68K.exe (under Wine,
* tests/oracle/wine/sim) and the port (tests/conformance/sim/harness.ts) run the
* same program; it writes what it observed to the file result.bin with the
* TRAP #15 file tasks, and the two files are compared byte for byte.
* First version: tools/oracle-official/sim/dumplib.X68 (official-oracle.md 5.1).
*
* Usage: the program INCLUDEs this file after its code (before END):
*
*   JSR     DMP_OPEN        ; create result.bin (TRAP #15 task 52)
*   JSR     DMP_REGS        ; one line: D0-D7 A0-A7 SR (values at the call)
*   LEA     start,A0
*   MOVE.L  #len,D0
*   JSR     DMP_MEM         ; hex dump, 16 bytes per line
*   LEA     msg,A1
*   JSR     DMP_TEXT        ; one line of text (NUL-terminated string at A1)
*   LEA     name,A1
*   JSR     DMP_VAL         ; one line "name=xxxxxxxx" with the value of D1.L
*   JSR     DMP_CLRC        ; clear the cycle counter (task 30)
*   JSR     DMP_CYC         ; one line "CYC=xxxxxxxx" (task 31)
*   JSR     DMP_POS         ; one line "POS=xxxx": the text cursor (task 11 $00FF)
*   MOVE.W  #row,D1
*   MOVE.W  #cols,D2
*   JSR     DMP_ROW         ; one line "ROW rrrr: hh hh ...": task 22 for columns 0..cols-1
*   JSR     DMP_CLOSE       ; the line END-OF-DUMP, then close (task 56)
*   SIMHALT
*
* Every routine preserves all registers and the condition codes. A7 is
* reported as the stack pointer of the caller (before the JSR). Lines end in
* CR LF. The marker line END-OF-DUMP tells the harness that the file is
* complete. The routines use TRAP #15 tasks 52, 54, 56 (files), 30, 31
* (cycles), 11 and 22 (text screen) and nothing else; they draw nothing.
* The cycle counts the routines themselves add are the same in every run, so
* a CYC line compares the instructions between DMP_CLRC and DMP_CYC.
*-----------------------------------------------------------------------------

DMP_OPEN:
        MOVE.W  SR,DMP_SAVSR
        MOVEM.L D0-D7/A0-A6,DMP_SAVE
        LEA     DMP_NAME,A1
        MOVE.L  #52,D0                  ; open new file, name at (A1)
        TRAP    #15
        MOVE.L  D1,DMP_FID
        BRA     DMP_RET

DMP_CLOSE:
        MOVE.W  SR,DMP_SAVSR
        MOVEM.L D0-D7/A0-A6,DMP_SAVE
        LEA     DMP_ENDTXT,A1
        BSR     DMP_PUTS0
        BSR     DMP_FLUSH
        MOVE.L  DMP_FID,D1
        MOVE.L  #56,D0                  ; close file
        TRAP    #15
        BRA     DMP_RET

* one text line: A1 = NUL-terminated string
DMP_TEXT:
        MOVE.W  SR,DMP_SAVSR
        MOVEM.L D0-D7/A0-A6,DMP_SAVE
        BSR     DMP_PUTS0
        BSR     DMP_FLUSH
        BRA     DMP_RET

* one line "name=xxxxxxxx": A1 = NUL-terminated name, D1.L = value
DMP_VAL:
        MOVE.W  SR,DMP_SAVSR
        MOVEM.L D0-D7/A0-A6,DMP_SAVE
        MOVE.L  D1,D3
        BSR     DMP_PUTS0
        MOVE.B  #'=',D1
        BSR     DMP_PUTC
        MOVEQ   #8,D4
        BSR     DMP_HEX
        BSR     DMP_FLUSH
        BRA     DMP_RET

* clear the cycle counter
DMP_CLRC:
        MOVE.W  SR,DMP_SAVSR
        MOVEM.L D0-D7/A0-A6,DMP_SAVE
        MOVEQ   #30,D0
        TRAP    #15
        BRA     DMP_RET

* one line "CYC=xxxxxxxx": the cycle counter
DMP_CYC:
        MOVE.W  SR,DMP_SAVSR
        MOVEM.L D0-D7/A0-A6,DMP_SAVE
        MOVEQ   #31,D0
        TRAP    #15
        MOVE.L  D1,D3
        LEA     DMP_CYCTXT,A1
        BSR     DMP_PUTS0
        MOVEQ   #8,D4
        BSR     DMP_HEX
        BSR     DMP_FLUSH
        BRA     DMP_RET

* one line "POS=xxxx": D1.W of task 11 get (column in the high byte, row in the low byte)
DMP_POS:
        MOVE.W  SR,DMP_SAVSR
        MOVEM.L D0-D7/A0-A6,DMP_SAVE
        MOVE.W  #$00FF,D1
        MOVEQ   #11,D0
        TRAP    #15
        MOVEQ   #0,D3
        MOVE.W  D1,D3
        LEA     DMP_POSTXT,A1
        BSR     DMP_PUTS0
        MOVEQ   #4,D4
        BSR     DMP_HEX
        BSR     DMP_FLUSH
        BRA     DMP_RET

* one line "ROW rrrr: hh hh ...": task 22 at row D1.W, columns 0 .. D2.W-1
DMP_ROW:
        MOVE.W  SR,DMP_SAVSR
        MOVEM.L D0-D7/A0-A6,DMP_SAVE
        MOVE.W  D1,D5                   ; row
        MOVE.W  D2,D6                   ; columns
        LEA     DMP_ROWTXT,A1
        BSR     DMP_PUTS0
        MOVEQ   #0,D3
        MOVE.W  D5,D3
        MOVEQ   #4,D4
        BSR     DMP_HEX
        MOVE.B  #':',D1
        BSR     DMP_PUTC
        MOVEQ   #0,D7                   ; column
DMP_ROWL:
        CMP.W   D6,D7
        BHS     DMP_ROWX
        MOVE.B  #' ',D1
        BSR     DMP_PUTC
        MOVE.W  D5,D1
        SWAP    D1
        MOVE.W  D7,D1                   ; row in the high word, column in the low word
        MOVEQ   #22,D0
        TRAP    #15
        MOVEQ   #0,D3
        MOVE.B  D1,D3
        MOVEQ   #2,D4
        BSR     DMP_HEX
        ADDQ.W  #1,D7
        BRA     DMP_ROWL
DMP_ROWX:
        BSR     DMP_FLUSH
        BRA     DMP_RET

* register line: "D0=xxxxxxxx D1=... A7=xxxxxxxx SR=xxxx"
DMP_REGS:
        MOVE.W  SR,DMP_SAVSR
        MOVEM.L D0-D7/A0-A6,DMP_SAVE
        MOVEA.L SP,A0                   ; caller's stack pointer (not LEA:
        ADDQ.L  #4,A0                   ; Sim68K masks LEA results to 24 bits)
        MOVE.L  A0,DMP_SAVE+60
        LEA     DMP_SAVE,A3             ; values
        LEA     DMP_RNAMES,A4           ; "D0D1...A7"
        MOVEQ   #15,D6
DMP_RLOOP:
        MOVE.B  (A4)+,D1
        BSR     DMP_PUTC
        MOVE.B  (A4)+,D1
        BSR     DMP_PUTC
        MOVE.B  #'=',D1
        BSR     DMP_PUTC
        MOVE.L  (A3)+,D3
        MOVEQ   #8,D4
        BSR     DMP_HEX
        MOVE.B  #' ',D1
        BSR     DMP_PUTC
        DBRA    D6,DMP_RLOOP
        LEA     DMP_SRTXT,A1
        BSR     DMP_PUTS0
        MOVEQ   #0,D3
        MOVE.W  DMP_SAVSR,D3
        MOVEQ   #4,D4
        BSR     DMP_HEX
        BSR     DMP_FLUSH
        BRA     DMP_RET

* memory: A0 = start, D0.L = byte count. Lines "aaaaaaaa: bb bb ... bb"
DMP_MEM:
        MOVE.W  SR,DMP_SAVSR
        MOVEM.L D0-D7/A0-A6,DMP_SAVE
        MOVE.L  D0,D5                   ; bytes left
DMP_MLINE:
        TST.L   D5
        BEQ     DMP_RET
        MOVE.L  A0,D3
        MOVEQ   #8,D4
        BSR     DMP_HEX
        MOVE.B  #':',D1
        BSR     DMP_PUTC
        MOVEQ   #15,D6                  ; up to 16 bytes per line
DMP_MBYTE:
        MOVE.B  #' ',D1
        BSR     DMP_PUTC
        MOVEQ   #0,D3
        MOVE.B  (A0)+,D3
        MOVEQ   #2,D4
        BSR     DMP_HEX
        SUBQ.L  #1,D5
        BEQ     DMP_MEND
        DBRA    D6,DMP_MBYTE
DMP_MEND:
        BSR     DMP_FLUSH
        BRA     DMP_MLINE

* common exit: restore registers and condition codes
DMP_RET:
        MOVEM.L DMP_SAVE,D0-D7/A0-A6
        MOVE.W  DMP_SAVSR,-(SP)
        ANDI.W  #$00FF,(SP)
        MOVE.W  (SP)+,CCR
        RTS

*--- helpers (clobber registers; called only between save and DMP_RET) ---

* append byte D1 to the line buffer
DMP_PUTC:
        MOVEA.L DMP_PTR,A2
        MOVE.B  D1,(A2)+
        MOVE.L  A2,DMP_PTR
        RTS

* append a NUL-terminated string (A1) to the line buffer
DMP_PUTS0:
        MOVE.B  (A1)+,D1
        BEQ     DMP_PUTS0X
        BSR     DMP_PUTC
        BRA     DMP_PUTS0
DMP_PUTS0X:
        RTS

* append D4 hex digits of D3 (most significant first)
DMP_HEX:
        MOVE.L  D4,D2
        SUBQ.L  #1,D2
        LSL.L   #2,D2                   ; shift for first digit
DMP_HEXL:
        MOVE.L  D3,D1
        LSR.L   D2,D1
        ANDI.L  #$F,D1
        LEA     DMP_DIGITS,A1
        MOVE.B  0(A1,D1.W),D1
        BSR     DMP_PUTC
        SUBQ.L  #4,D2
        BPL     DMP_HEXL
        RTS

* append CR LF and write the line buffer to the file
DMP_FLUSH:
        MOVE.B  #13,D1
        BSR     DMP_PUTC
        MOVE.B  #10,D1
        BSR     DMP_PUTC
        LEA     DMP_BUF,A1
        MOVE.L  DMP_PTR,D2
        SUB.L   A1,D2                   ; length
        MOVE.L  DMP_FID,D1
        MOVE.L  #54,D0                  ; write file
        TRAP    #15
        MOVE.L  #DMP_BUF,DMP_PTR
        RTS

DMP_NAME    DC.B    'result.bin',0
DMP_DIGITS  DC.B    '0123456789ABCDEF'
DMP_RNAMES  DC.B    'D0D1D2D3D4D5D6D7A0A1A2A3A4A5A6A7'
DMP_SRTXT   DC.B    'SR=',0
DMP_CYCTXT  DC.B    'CYC=',0
DMP_POSTXT  DC.B    'POS=',0
DMP_ROWTXT  DC.B    'ROW ',0
DMP_ENDTXT  DC.B    'END-OF-DUMP',0
            DS.W    0
DMP_FID     DC.L    0
DMP_PTR     DC.L    DMP_BUF
DMP_SAVSR   DC.W    0
DMP_SAVE    DS.L    16
DMP_BUF     DS.B    1200
            DS.W    0
