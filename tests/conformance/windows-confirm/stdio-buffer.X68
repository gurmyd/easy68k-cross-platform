*-----------------------------------------------------------------------------
* stdio-buffer.X68 - what the C library of SIM68K.exe buffers (ARCHITECTURE.md
* 3.8.4, 6.8; O-15). Run it on real Windows: SIM68K.exe stdio-buffer.S68 /r,
* in a folder you can write to; it writes its findings to result.bin there.
*
* A. Buffer size: bytes are written one at a time through one stream (W) and
*    after each byte a second stream (R) seeks to 0 and reads everything that
*    is visible. A line "written=w visible=v" is written whenever v changes.
* B. Large writes: after 10 buffered bytes, one write of 1000 bytes, then one
*    of 5000 bytes on a fresh file: what a reader sees right after each.
* C. Stale reads: R reads 10 bytes of a 100-byte file of 'a'; another stream
*    overwrites bytes 50-59 with 'B' and closes; R reads 50 more bytes without
*    a seek: 'B' there means the reading stream keeps no stale buffer.
*-----------------------------------------------------------------------------
    ORG     $1000
START:
    JSR     DMP_OPEN
* --- A ---
    LEA     FA,A1
    MOVEQ   #52,D0
    TRAP    #15
    MOVE.L  D1,D6               ; W
    LEA     FA,A1
    MOVEQ   #51,D0
    TRAP    #15
    MOVE.L  D1,D7               ; R
    LEA     OPENR,A1
    JSR     DMP_VAL
    MOVEQ   #0,D5               ; written
    MOVEQ   #-1,D4              ; last visible
ALOOP:
    MOVE.L  D6,D1
    LEA     ONE,A1
    MOVEQ   #1,D2
    MOVEQ   #54,D0
    TRAP    #15
    ADDQ.L  #1,D5
    BSR     VISIBLE
    CMP.L   D4,D3
    BEQ     ASAME
    MOVE.L  D3,D4
    MOVE.L  D5,D1
    LEA     WRITTEN,A1
    JSR     DMP_VAL
    MOVE.L  D3,D1
    LEA     VIS,A1
    JSR     DMP_VAL
ASAME:
    CMP.L   #2100,D5
    BLO     ALOOP
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
    BSR     VISIBLE
    MOVE.L  D3,D1
    LEA     ACLOSED,A1
    JSR     DMP_VAL
    MOVE.L  D7,D1
    MOVEQ   #56,D0
    TRAP    #15
* --- B ---
    LEA     FB,A1
    MOVEQ   #52,D0
    TRAP    #15
    MOVE.L  D1,D6
    LEA     FB,A1
    MOVEQ   #51,D0
    TRAP    #15
    MOVE.L  D1,D7
    MOVE.L  D6,D1
    LEA     BIG,A1
    MOVEQ   #10,D2
    MOVEQ   #54,D0
    TRAP    #15
    BSR     VISIBLE
    MOVE.L  D3,D1
    LEA     B10,A1
    JSR     DMP_VAL
    MOVE.L  D6,D1
    LEA     BIG,A1
    MOVE.L  #1000,D2
    MOVEQ   #54,D0
    TRAP    #15
    BSR     VISIBLE
    MOVE.L  D3,D1
    LEA     B1000,A1
    JSR     DMP_VAL
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
    MOVE.L  D7,D1
    MOVEQ   #56,D0
    TRAP    #15
    LEA     FC,A1
    MOVEQ   #52,D0
    TRAP    #15
    MOVE.L  D1,D6
    LEA     FC,A1
    MOVEQ   #51,D0
    TRAP    #15
    MOVE.L  D1,D7
    MOVE.L  D6,D1
    LEA     BIG,A1
    MOVE.L  #5000,D2
    MOVEQ   #54,D0
    TRAP    #15
    BSR     VISIBLE
    MOVE.L  D3,D1
    LEA     B5000,A1
    JSR     DMP_VAL
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
    MOVE.L  D7,D1
    MOVEQ   #56,D0
    TRAP    #15
* --- C ---
    LEA     FD,A1
    MOVEQ   #52,D0
    TRAP    #15
    MOVE.L  D1,D6
    LEA     AAA,A1
    MOVEQ   #100,D2
    MOVEQ   #54,D0
    TRAP    #15
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
    LEA     FD,A1
    MOVEQ   #51,D0
    TRAP    #15
    MOVE.L  D1,D7               ; R
    MOVE.L  D7,D1
    LEA     RBUF,A1
    MOVEQ   #10,D2
    MOVEQ   #53,D0
    TRAP    #15
    LEA     FD,A1
    MOVEQ   #51,D0
    TRAP    #15
    MOVE.L  D1,D6               ; second stream
    MOVE.L  D6,D1
    MOVEQ   #50,D2
    MOVEQ   #55,D0
    TRAP    #15
    MOVE.L  D6,D1
    LEA     BBB,A1
    MOVEQ   #10,D2
    MOVEQ   #54,D0
    TRAP    #15
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
    MOVE.L  D7,D1
    LEA     RBUF,A1
    MOVEQ   #50,D2
    MOVEQ   #53,D0
    TRAP    #15
    JSR     DMP_REGS
    LEA     RBUF,A0
    MOVEQ   #50,D0
    JSR     DMP_MEM
    MOVE.L  D7,D1
    MOVEQ   #56,D0
    TRAP    #15
    JSR     DMP_CLOSE
    SIMHALT
* D3 = bytes R (D7) sees from the start of the file
VISIBLE:
    MOVEM.L D0-D2/A1,-(SP)
    MOVE.L  D7,D1
    MOVEQ   #0,D2
    MOVEQ   #55,D0
    TRAP    #15
    MOVE.L  D7,D1
    LEA     RBUF,A1
    MOVE.L  #8192,D2
    MOVEQ   #53,D0
    TRAP    #15
    MOVE.L  D2,D3
    CMP.W   #1,D0
    BNE     VISERR
    MOVEQ   #0,D3               ; end of file: nothing was read (D2 is not changed then)
VISERR:
    CMP.W   #2,D0
    BNE     VISX
    MOVEQ   #-2,D3              ; the read failed
VISX:
    MOVEM.L (SP)+,D0-D2/A1
    RTS
FA      DC.B 'stdio-a.bin',0
FB      DC.B 'stdio-b.bin',0
FC      DC.B 'stdio-c.bin',0
FD      DC.B 'stdio-d.bin',0
OPENR   DC.B 'secondStreamD0D1',0
WRITTEN DC.B 'written',0
VIS     DC.B 'visible',0
ACLOSED DC.B 'visibleAfterClose',0
B10     DC.B 'visibleAfter10',0
B1000   DC.B 'visibleAfter10plus1000',0
B5000   DC.B 'visibleAfter5000',0
ONE     DC.B 'x'
AAA     DCB.B 100,'a'
BBB     DCB.B 10,'B'
    DS.W    0
BIG     DCB.B 5000,'z'
RBUF    DS.B  8192
    INCLUDE '..\sim\dumplib.X68'
    END     START