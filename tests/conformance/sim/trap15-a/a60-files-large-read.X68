* @item ARCHITECTURE.md 3.8.4 / docs/porting/errata/SH6.md "What T3 is asked
* @item to confirm" item 1, the last open buffering case: a read of 512 bytes or
* @item more. A file of 2000 'A'; stream R reads 1000 bytes; stream W opens the
* @item same file anew (task 52), writes 2000 'B' and closes it; R reads 10 more
* @item bytes. A buffered block 512-1023 in R gives 'A' ($41), a large read passed
* @item straight through and a refill give 'B' ($42).
* @owner SH6
    ORG     $1000
START:
    JSR     DMP_OPEN
* --- the file: 2000 'A' ---
    LEA     FNAME,A1
    MOVEQ   #52,D0
    TRAP    #15
    MOVE.L  D1,D6
    LEA     BIGA,A1
    MOVE.L  #2000,D2
    MOVEQ   #54,D0
    TRAP    #15
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
* --- R reads 1000 bytes ---
    LEA     FNAME,A1
    MOVEQ   #51,D0
    TRAP    #15
    MOVE.L  D1,D7
    LEA     RBUF,A1
    MOVE.L  #1000,D2
    MOVEQ   #53,D0
    TRAP    #15
    LEA     L1RES,A1
    BSR     SHOWD0
    MOVE.L  D2,D1
    LEA     L1CNT,A1
    JSR     DMP_VAL
    MOVEQ   #0,D1
    MOVE.B  RBUF+999,D1
    LEA     L1LAST,A1
    JSR     DMP_VAL
* --- W: task 52 on the same file, 2000 'B', close ---
    LEA     FNAME,A1
    MOVEQ   #52,D0
    TRAP    #15
    MOVE.L  D1,D6
    LEA     L2OPEN,A1
    BSR     SHOWD0
    MOVE.L  D6,D1
    LEA     BIGB,A1
    MOVE.L  #2000,D2
    MOVEQ   #54,D0
    TRAP    #15
    LEA     L2WRITE,A1
    BSR     SHOWD0
    MOVE.L  D6,D1
    MOVEQ   #56,D0
    TRAP    #15
    LEA     L2CLOSE,A1
    BSR     SHOWD0
* --- R reads 10 more bytes ---
    LEA     RBUF,A0
    MOVE.L  #$2E2E2E2E,(A0)+    ; '....' so that a short read shows
    MOVE.L  #$2E2E2E2E,(A0)+
    MOVE.W  #$2E2E,(A0)
    MOVE.L  D7,D1
    LEA     RBUF,A1
    MOVEQ   #10,D2
    MOVEQ   #53,D0
    TRAP    #15
    LEA     L3RES,A1
    BSR     SHOWD0
    MOVE.L  D2,D1
    LEA     L3CNT,A1
    JSR     DMP_VAL
    MOVE.L  RBUF,D1
    LEA     L3FIRST,A1
    JSR     DMP_VAL
    MOVE.L  RBUF+6,D1
    LEA     L3LAST,A1
    JSR     DMP_VAL
    MOVE.L  D7,D1
    MOVEQ   #56,D0
    TRAP    #15
* --- what a new stream reads from the start: the file as W left it ---
    LEA     FNAME,A1
    MOVEQ   #51,D0
    TRAP    #15
    MOVE.L  D1,D7
    LEA     RBUF,A1
    MOVE.L  #4000,D2
    MOVEQ   #53,D0
    TRAP    #15
    MOVE.L  D2,D1
    LEA     L4CNT,A1
    JSR     DMP_VAL
    MOVE.L  RBUF,D1
    LEA     L4FIRST,A1
    JSR     DMP_VAL
    MOVE.L  D7,D1
    MOVEQ   #56,D0
    TRAP    #15
    JSR     DMP_CLOSE
    SIMHALT
* D0.W of the last task as a value line named at A1
SHOWD0:
    MOVEQ   #0,D1
    MOVE.W  D0,D1
    JSR     DMP_VAL
    RTS
FNAME   DC.B 'large-read.bin',0
L1RES   DC.B 'firstRead1000Result',0
L1CNT   DC.B 'firstRead1000Count',0
L1LAST  DC.B 'firstReadByte999',0
L2OPEN  DC.B 'otherStreamOpenNewResult',0
L2WRITE DC.B 'otherStreamWrite2000Result',0
L2CLOSE DC.B 'otherStreamCloseResult',0
L3RES   DC.B 'nextRead10Result',0
L3CNT   DC.B 'nextRead10Count',0
L3FIRST DC.B 'nextRead10Bytes0to3',0
L3LAST  DC.B 'nextRead10Bytes6to9',0
L4CNT   DC.B 'newStreamReadCount',0
L4FIRST DC.B 'newStreamBytes0to3',0
    DS.W    0
BIGA    DCB.B 2000,'A'
BIGB    DCB.B 2000,'B'
RBUF    DS.B  4096
    INCLUDE '..\dumplib.X68'
    END     START
