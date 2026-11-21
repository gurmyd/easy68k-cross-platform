* @item trap15-a 13 Text output: task 6 with $01, $1B or $00 does nothing; with
* @item $7F or $E9 a glyph is stored and the cursor advances; $80-$FF print
* @recipe report outlog
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     CODES,A2
LOOP:
    MOVE.B  (A2)+,D1
    CMP.B   #$FF,D1
    BEQ     DONE
    MOVEQ   #6,D0
    TRAP    #15
    JSR     DMP_POS
    BRA     LOOP
DONE:
    MOVEQ   #0,D1
    MOVE.W  #12,D2
    JSR     DMP_ROW
    JSR     DMP_CLOSE
    SIMHALT
CODES DC.B  'a',$01,$1B,$00,$7F,$E9,$80,$9F,$A0,$1F,$0E,'z',$FE,$FF
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START