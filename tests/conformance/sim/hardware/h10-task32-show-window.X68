* @item hardware 13 / trap15-a task 32 sub-task 0 (show the Hardware window):
* @item no register changes (only D1.B selects the sub-task: D1 = $12345600),
* @item and the device bytes read the same before and after (task 32/1 gives
* @item the address of the LED byte, task 32/2 of the switches)
* @owner SH7
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVE.L  #$12345600,D1
    MOVE.L  #$CAFEBABE,D2
    MOVE.L  #$ABCD0020,D0       ; task 32, sub-task 0
    TRAP    #15
    JSR     DMP_REGS
    MOVEQ   #1,D1
    MOVEQ   #32,D0              ; task 32/1: address of the LEDs
    TRAP    #15
    MOVEA.L D1,A3
    MOVEQ   #2,D1
    MOVEQ   #32,D0              ; task 32/2: address of the switches
    TRAP    #15
    MOVEA.L D1,A4
    MOVE.B  (A4),D5
    MOVE.B  #$5A,(A3)
    MOVEQ   #0,D1
    MOVEQ   #32,D0              ; show it again (already shown)
    TRAP    #15
    MOVE.B  (A3),D6
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START
