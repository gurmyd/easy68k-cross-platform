* @item trap15-b 12.2 task 107 (receive data and port) before any task 100 or
* @item 101: nothing is bound, so it returns at once with D0.L = 0 and 0 bytes
* @item in D1.W, leaving both buffers as the program filled them. The high word
* @item of D1 is the sender's port, which no receive set: an uninitialised local
* @item of the original (simIOu.cpp receivePortNet), 0 in the port (trap15-b
* @item 12.2 PORT note). Task 103, which has no port, is in b18
* @owner W1
    ORG     $1000
START:
    JSR     DMP_OPEN
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
* task 107: receive up to 16 bytes with the sender's port
    LEA     RXBUF,A1
    LEA     IPBUF,A2
    MOVE.L  #$ABCD0010,D1
    MOVE.L  #$ABCD006B,D0       ; task 107
    TRAP    #15
    JSR     DMP_REGS
    LEA     RXBUF,A0
    MOVEQ   #32,D0
    JSR     DMP_MEM
    JSR     DMP_CLOSE
    SIMHALT

    DS.W    0
RXBUF  DS.B 16
IPBUF  DS.B 16
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START
