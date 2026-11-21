* @item trap15-b 4.6: colours with a non-zero top byte for task 80 (palette
* @item index $01xxxxxx, $02xxxxxx and others) drawn as pixels and read back
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     COLOURS,A3
    MOVE.W  #10,D6
LOOP:
    MOVE.L  (A3)+,D1
    CMP.L   #-1,D1
    BEQ     DONE
    MOVEQ   #80,D0
    TRAP    #15
    MOVE.W  D6,D1
    MOVE.W  #10,D2
    MOVEQ   #82,D0
    TRAP    #15
    MOVEQ   #83,D0
    TRAP    #15
    MOVE.L  -4(A3),D5
    MOVE.L  D0,D7
    JSR     DMP_REGS
    ADDQ.W  #2,D6
    BRA     LOOP
DONE:
    JSR     DMP_CLOSE
    SIMHALT
COLOURS DC.L $00123456,$01000000,$01000005,$02123456,$04123456,$40FFFFFF,$7F010203,-1
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START