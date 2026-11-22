* @item trap15-b 12.2 tasks 102 (send) and 106 (send on port) before any task
* @item 100 or 101: the simulator is neither client nor server and Winsock is
* @item not started, so the sendto on the never-created socket fails; D0.L is
* @item (Winsock error << 16) + 1 and D1 keeps its value (trap15-b expects
* @item $276D0001, "not initialised"). (A1) and (A2) are dumped after the calls
* @owner W1
    ORG     $1000
START:
    JSR     DMP_OPEN
* task 102: send 5 bytes to 127.0.0.1
    LEA     TXDATA,A1
    LEA     DEST,A2
    MOVE.L  #$ABCD0005,D1
    MOVE.L  #$ABCD0066,D0       ; task 102
    TRAP    #15
    JSR     DMP_REGS
* task 106: send 5 bytes on port $0800
    LEA     TXDATA,A1
    LEA     DEST,A2
    MOVE.L  #$08000005,D1
    MOVE.L  #$ABCD006A,D0       ; task 106
    TRAP    #15
    JSR     DMP_REGS
    LEA     TXDATA,A0
    MOVEQ   #16,D0
    JSR     DMP_MEM
    JSR     DMP_CLOSE
    SIMHALT

TXDATA DC.B 'HELLO'
DEST   DC.B '127.0.0.1',0,0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START
