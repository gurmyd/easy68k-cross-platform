* @item trap15-b 12.2 tasks 104, 103 and 105 before any task 100 or 101, so
* @item Winsock is not started and nothing is bound: close (104) reports an
* @item error in D0.L and keeps D1; receive (103) returns at once with D0.L = 0
* @item and D1.L = 0 bytes (the high word set before the call is cleared),
* @item leaving both buffers as the program filled them; close again, then
* @item task 105 shows that none of the calls started Winsock. Tasks 102 and
* @item 106 are in b19, task 107 in b20
* @owner W1
    ORG     $1000
START:
    JSR     DMP_OPEN
    BSR     FILLBUF
* task 104: close, nothing opened (D1 is ignored by the source)
    MOVE.L  #$12345678,D1
    MOVE.L  #$ABCD0068,D0       ; task 104
    TRAP    #15
    JSR     DMP_REGS
* task 103: receive up to 16 bytes
    LEA     RXBUF,A1
    LEA     IPBUF,A2
    MOVE.L  #$ABCD0010,D1
    MOVE.L  #$ABCD0067,D0       ; task 103
    TRAP    #15
    JSR     DMP_REGS
    BSR     DUMPBUF
* task 104 again, after the receive
    MOVE.L  #$12345678,D1
    MOVE.L  #$ABCD0068,D0       ; task 104
    TRAP    #15
    JSR     DMP_REGS
* task 105: still no Winsock, so an error and (A2) untouched
    LEA     IPBUF,A2
    MOVE.L  #$12345678,D1
    MOVE.L  #$ABCD0069,D0       ; task 105
    TRAP    #15
    JSR     DMP_REGS
    BSR     DUMPBUF
    JSR     DMP_CLOSE
    SIMHALT

* RXBUF = 16 x $AA, IPBUF = 16 x $BB
FILLBUF:
    LEA     RXBUF,A0
    MOVEQ   #15,D2
FILLRX:
    MOVE.B  #$AA,(A0)+
    DBRA    D2,FILLRX
    LEA     IPBUF,A0
    MOVEQ   #15,D2
FILLIP:
    MOVE.B  #$BB,(A0)+
    DBRA    D2,FILLIP
    RTS

* dump RXBUF and IPBUF (32 bytes)
DUMPBUF:
    MOVEM.L D0/A0,-(SP)
    LEA     RXBUF,A0
    MOVEQ   #32,D0
    JSR     DMP_MEM
    MOVEM.L (SP)+,D0/A0
    RTS

    DS.W    0
RXBUF  DS.B 16
IPBUF  DS.B 16
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START
