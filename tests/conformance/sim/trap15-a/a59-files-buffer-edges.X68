* @item ARCHITECTURE.md 3.8.4 / docs/porting/errata/SH6.md "What T3 is asked
* @item to confirm" item 1: what a second stream sees of a file written through
* @item the C library's 512-byte buffer: 300 + 300 bytes in two task 54 calls;
* @item one write of exactly 512; 511 then 1 then 1; one write of 513
* @owner SH6
    ORG     $1000
START:
    JSR     DMP_OPEN
* --- 300 + 300 ---
    LEA     FA,A1
    BSR     OPEN2
    MOVE.L  #300,D2
    BSR     WRITEW
    LEA     A300,A1
    BSR     SHOW
    MOVE.L  #300,D2
    BSR     WRITEW
    LEA     A600,A1
    BSR     SHOW
    BSR     CLOSE2
* --- exactly 512 ---
    LEA     FB,A1
    BSR     OPEN2
    MOVE.L  #512,D2
    BSR     WRITEW
    LEA     A512,A1
    BSR     SHOW
    BSR     CLOSE2
* --- 511, then 1, then 1 ---
    LEA     FC,A1
    BSR     OPEN2
    MOVE.L  #511,D2
    BSR     WRITEW
    LEA     A511,A1
    BSR     SHOW
    MOVEQ   #1,D2
    BSR     WRITEW
    LEA     A511P1,A1
    BSR     SHOW
    MOVEQ   #1,D2
    BSR     WRITEW
    LEA     A511P2,A1
    BSR     SHOW
    BSR     CLOSE2
* --- one write of 513 ---
    LEA     FD,A1
    BSR     OPEN2
    MOVE.L  #513,D2
    BSR     WRITEW
    LEA     A513,A1
    BSR     SHOW
    BSR     CLOSE2
    JSR     DMP_CLOSE
    SIMHALT
* the file named at A1: created through W (D6), opened for reading as R (D7)
OPEN2:
    MOVE.L  A1,A2
    MOVEQ   #52,D0
    TRAP    #15
    MOVE.L  D1,D6
    MOVE.L  A2,A1
    MOVEQ   #51,D0
    TRAP    #15
    MOVE.L  D1,D7
    RTS
CLOSE2:
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
    MOVE.L  D7,D1
    MOVEQ   #56,D0
    TRAP    #15
    RTS
* D2 bytes of BIG through W
WRITEW:
    MOVE.L  D6,D1
    LEA     BIG,A1
    MOVEQ   #54,D0
    TRAP    #15
    RTS
* the label at A1 and what R sees from the start of the file
SHOW:
    MOVE.L  A1,A2
    MOVE.L  D7,D1
    MOVEQ   #0,D2
    MOVEQ   #55,D0
    TRAP    #15
    MOVE.L  D7,D1
    LEA     RBUF,A1
    MOVE.L  #4096,D2
    MOVEQ   #53,D0
    TRAP    #15
    MOVE.L  D2,D1
    CMP.W   #1,D0
    BNE.S   SHOWE
    MOVEQ   #0,D1               ; end of file: nothing was read (D2 is not changed then)
SHOWE:
    CMP.W   #2,D0
    BNE.S   SHOWX
    MOVEQ   #-2,D1              ; the read failed
SHOWX:
    MOVE.L  A2,A1
    JSR     DMP_VAL
    RTS
FA      DC.B 'edge-a.bin',0
FB      DC.B 'edge-b.bin',0
FC      DC.B 'edge-c.bin',0
FD      DC.B 'edge-d.bin',0
A300    DC.B 'visibleAfter300',0
A600    DC.B 'visibleAfter300plus300',0
A512    DC.B 'visibleAfter512',0
A511    DC.B 'visibleAfter511',0
A511P1  DC.B 'visibleAfter511plus1',0
A511P2  DC.B 'visibleAfter511plus1plus1',0
A513    DC.B 'visibleAfter513',0
    DS.W    0
BIG     DCB.B 600,'z'
RBUF    DS.B  4096
    INCLUDE '..\dumplib.X68'
    END     START
