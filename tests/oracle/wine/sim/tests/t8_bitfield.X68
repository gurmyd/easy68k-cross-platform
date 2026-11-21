*-----------------------------------------------------------
* t8_bitfield: shows whether the simulator's "bit field enabled" option is
* on. With it off, BFEXTU is an illegal instruction (vector 4); the handler
* sets D7 = $B4B4B4B4 and skips the 4-byte instruction. With it on,
* D1 = $0000000A. The report is written either way.
* Needs the assembler's bit field option (on in the shipped settings.dat).
*-----------------------------------------------------------
    ORG     $1000
START:
    MOVE.L  #ILLEGAL,$10        ; vector 4: illegal instruction
    LEA     DUMPNAME,A1
    JSR     DMP_OPEN
    MOVEQ   #0,D7
    MOVE.L  #$A5000000,D0
    MOVEQ   #0,D1
    BFEXTU  D0{0:4},D1
    MOVE.L  #$600D600D,D6
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT

ILLEGAL:
    MOVE.L  #$B4B4B4B4,D7
    ADDQ.L  #4,2(SP)            ; skip BFEXTU (4 bytes)
    RTE

DUMPNAME DC.B   't8_bitfield_dump.txt',0
    DS.W    0
    INCLUDE 'dumplib.X68'
    END     START
