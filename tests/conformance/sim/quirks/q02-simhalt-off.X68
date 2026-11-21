* @item sim-core 3.13: *[sim68k]simhalt_off in the listing makes $FFFF $FFFF a
* @item line-F exception (here with exceptions enabled: through vector $2C, and
* @item the program goes on)
* @switches /e
*[sim68k]simhalt_off
    ORG     $1000
START:
    MOVE.L  #LINEF,$2C
    JSR     DMP_OPEN
    DC.W    $FFFF,$FFFF
    MOVE.L  COUNT,D1
    LEA     CNT,A1
    JSR     DMP_VAL
    JSR     DMP_CLOSE
    MOVEQ   #9,D0
    TRAP    #15
LINEF:
    ADDQ.L  #1,COUNT
    MOVE.L  2(SP),D1
    LEA     PCT,A1
    JSR     DMP_VAL
    ADDQ.L  #2,2(SP)            ; skip the second $FFFF as well
    RTE
COUNT DC.L  0
CNT   DC.B  'lineF',0
PCT   DC.B  'stackedPC',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START