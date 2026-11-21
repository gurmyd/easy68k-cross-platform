* @item hardware 13 item 12: an interrupt enters the handler at the long stored
* @item at $60+4n with SR mask = n, S = 1, T = 0 and a 6-byte frame (SR word at
* @item SP, return PC at SP+2) - level 5 and level 7 (non-maskable at mask 7);
* @item only the first entry of each level is recorded (a second request of
* @item the same level may already be latched: timing, not compared)
* @switches /e
    ORG     $1000
START:
    MOVE.L  #IRQ,$74
    MOVE.L  #IRQ,$7C
    JSR     DMP_OPEN
    MOVE    #$2400,SR
    MOVE.B  #$85,D2
    MOVE.L  #10,D3
    MOVEQ   #6,D1
    MOVEQ   #32,D0
    TRAP    #15
WAIT5:
    TST.B   SEEN5
    BEQ     WAIT5
WAIT5E:
    MOVE    #$2700,SR
    MOVE.B  #$87,D2
    MOVEQ   #6,D1
    MOVEQ   #32,D0
    TRAP    #15
WAIT7:
    TST.B   SEEN7
    BEQ     WAIT7
WAIT7E:
    LEA     FR5,A0
    MOVEQ   #12,D0
    JSR     DMP_MEM
    JSR     DMP_CLOSE
    SIMHALT
* records SR in the handler, the stacked SR and whether the stacked PC is in
* the wait loop of its level, for the first entry of each level only
IRQ:
    MOVEM.L D0-D3/A0-A1,-(SP)
    MOVE.W  SR,D2
    LSR.W   #8,D2
    AND.L   #7,D2               ; the level being serviced
    LEA     FR5,A0
    LEA     SEEN5,A1
    MOVE.L  #WAIT5,D3
    CMP.B   #5,D2
    BEQ     LEVEL
    LEA     FR7,A0
    LEA     SEEN7,A1
    MOVE.L  #WAIT7,D3
LEVEL:
    TST.B   (A1)
    BNE     DISABLE
    MOVE.W  SR,(A0)+
    MOVE.W  24(SP),(A0)+        ; stacked SR
    MOVE.L  26(SP),D0           ; stacked PC
    SUB.L   D3,D0
    CMP.L   #WAIT5E-WAIT5,D0    ; both loops have the same length
    SLO     D1
    MOVE.B  D1,(A0)+
    MOVE.B  #$AA,(A0)+
    ST      (A1)
DISABLE:
    MOVEQ   #6,D1               ; this level only: a 'disable all' would stop
    MOVEQ   #32,D0              ; the timers until the next Run (item 19)
    TRAP    #15
    MOVEM.L (SP)+,D0-D3/A0-A1
    RTE
SEEN5  DC.B 0
SEEN7  DC.B 0
FR5    DS.B 6
FR7    DS.B 6
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START