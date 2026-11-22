* @item trap15-b 12.2 task 105 (get the local IP address) before any network
* @item task: Winsock is not started, so the result in D0.L is an error and
* @item the 20 bytes at (A2) stay as the program filled them. The address a
* @item started network would give depends on the machine and is left out
* @owner W1
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     IPBUF,A2
    MOVEQ   #19,D2
FILL:
    MOVE.B  #$AA,(A2)+
    DBRA    D2,FILL
    LEA     IPBUF,A2
    MOVE.L  #$12345678,D1
    MOVE.L  #$ABCD0069,D0       ; task 105
    TRAP    #15
    JSR     DMP_REGS
    LEA     IPBUF,A0
    MOVEQ   #20,D0
    JSR     DMP_MEM
    JSR     DMP_CLOSE
    SIMHALT
IPBUF DS.B  20
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START
