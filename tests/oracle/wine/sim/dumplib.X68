*-----------------------------------------------------------------------------
* dumplib.X68 - self-reporting dump routines for EASy68K test programs
*
* Part of easy68k-mac (GPL-2.0-or-later). Used to make the OFFICIAL SIM68K.exe
* write its own results to a text file, so a script can collect them without
* any user-interface automation (see docs/porting/official-oracle.md).
*
* Usage: put   INCLUDE 'dumplib.X68'   after your program code (before END).
*
*   LEA     name,A1         ; NUL-terminated file name (relative = sim's cwd)
*   JSR     DMP_OPEN        ; create/truncate the dump file
*   JSR     DMP_REGS        ; one line: D0-D7 A0-A7 SR (values at the call)
*   LEA     start,A0
*   MOVE.L  #len,D0
*   JSR     DMP_MEM         ; hex dump, 16 bytes per line
*   LEA     msg,A1
*   JSR     DMP_TEXT        ; one line of text (NUL-terminated string)
*   JSR     DMP_CLOSE       ; writes the END-OF-DUMP marker and closes
*   SIMHALT
*
* Every routine preserves all registers and the condition codes. A7 is
* reported as the stack pointer of the caller (before the JSR). Lines end in
* CR LF. The marker line "END-OF-DUMP" tells the harness the file is complete.
* Uses TRAP #15 tasks 52 (open new), 54 (write), 56 (close).
*-----------------------------------------------------------------------------

DMP_OPEN:
        MOVE.W  SR,DMP_SAVSR
        MOVEM.L D0-D7/A0-A6,DMP_SAVE
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

* write one text line: A1 = NUL-terminated string
DMP_TEXT:
        MOVE.W  SR,DMP_SAVSR
        MOVEM.L D0-D7/A0-A6,DMP_SAVE
        BSR     DMP_PUTS0
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

DMP_DIGITS  DC.B    '0123456789ABCDEF'
DMP_RNAMES  DC.B    'D0D1D2D3D4D5D6D7A0A1A2A3A4A5A6A7'
DMP_SRTXT   DC.B    'SR=',0
DMP_ENDTXT  DC.B    'END-OF-DUMP',0
            DS.W    0
DMP_FID     DC.L    0
DMP_PTR     DC.L    DMP_BUF
DMP_SAVSR   DC.W    0
DMP_SAVE    DS.L    16
DMP_BUF     DS.B    256
            DS.W    0
