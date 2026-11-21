* @item trap15-a 13 Memory map: with MEMORY ROM $8000,$8FFF, task 53 into the
* @item ROM reads nothing and D0 keeps $35 in its low byte; MOVE to the ROM is
* @item ignored (hardware 13 item 30); the loader can place data there
    MEMORY  ROM $8000,$8FFF
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     NAME,A1
    MOVEQ   #52,D0
    TRAP    #15
    MOVE.L  D1,D6
    LEA     DATA,A1
    MOVEQ   #4,D2
    MOVEQ   #54,D0
    TRAP    #15
    MOVE.L  D6,D1
    MOVEQ   #0,D2
    MOVEQ   #55,D0
    TRAP    #15
    MOVE.L  D6,D1
    LEA     $8000,A1
    MOVEQ   #4,D2
    MOVEQ   #53,D0
    TRAP    #15
    JSR     DMP_REGS
    MOVE.L  #$11223344,$8004
    MOVE.L  #$55667788,$7FFE
    LEA     $7FF8,A0
    MOVEQ   #24,D0
    JSR     DMP_MEM
    JSR     DMP_CLOSE
    SIMHALT
NAME DC.B   'rom.bin',0
DATA DC.B   'WXYZ'
    INCLUDE '..\dumplib.X68'
    ORG     $8000
    DC.B    'loaded into ROM!'
    END     START