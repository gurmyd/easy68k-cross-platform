* @item hardware 13 item 8: a write to a hardware address inside an enabled ROM
* @item range still succeeds (the device bytes read back), while ROM elsewhere
* @item ignores the write
    MEMORY  ROM $E00000,$E000FF
    MEMORY  ROM $3000,$30FF
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVE.B  #$3F,$E00000
    MOVE.B  #$A5,$E00010
    MOVE.B  #$12,$E00020
    MOVE.B  #$34,$3010
    LEA     $E00000,A0
    MOVEQ   #20,D0
    JSR     DMP_MEM
    LEA     $E00020,A0
    MOVEQ   #2,D0
    JSR     DMP_MEM
    LEA     $3010,A0
    MOVEQ   #2,D0
    JSR     DMP_MEM
    JSR     DMP_CLOSE
    SIMHALT
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START