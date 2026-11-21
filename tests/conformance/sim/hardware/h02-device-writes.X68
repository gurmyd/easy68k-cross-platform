* @item hardware 13 items 2, 3: MOVE.B #$3F,$E00000; MOVE.B #$80,$E0000E;
* @item MOVE.W #$0600,$E00002 leaves $E00003 = $00; MOVE.B #$A5,$E00010; a long
* @item write across two digits; the bytes read back
    ORG     $1000
START:
    JSR     DMP_OPEN
    MOVE.B  #$3F,$E00000
    MOVE.B  #$80,$E0000E
    MOVE.W  #$0600,$E00002
    MOVE.B  #$A5,$E00010
    MOVE.L  #$11223344,$E00004
    MOVE.B  #$5A,$E00012
    MOVE.B  #$00,$E00014
    LEA     $E00000,A0
    MOVEQ   #24,D0
    JSR     DMP_MEM
    JSR     DMP_CLOSE
    SIMHALT
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START