* @item trap15-a 13 Memory map: with MEMORY INVALID $8000,$8FFF, task 14 on a
* @item string at $8000 and task 13 on one at $7FFE raise a bus error (here with
* @item exceptions enabled: the 14-byte frame the handler sees); an empty
* @item string at $8000 raises nothing
* @switches /e
    MEMORY  INVALID $8000,$8FFF
    ORG     $1000
START:
    MOVE.L  #BUSERR,$8
    JSR     DMP_OPEN
    LEA     $8000,A1
    MOVEQ   #14,D0
    TRAP    #15
    LEA     $7FFE,A1
    MOVEQ   #13,D0
    TRAP    #15
    MOVE.L  COUNT,D1
    LEA     CNT,A1
    JSR     DMP_VAL
    JSR     DMP_POS
    JSR     DMP_CLOSE
    SIMHALT
BUSERR:
    ADDQ.L  #1,COUNT
    JSR     DMP_REGS
    MOVEA.L SP,A0
    MOVEQ   #14,D0
    JSR     DMP_MEM
    ADDA.L  #14,SP
    MOVE.L  #RESUME,-(SP)
    MOVE.W  #$2000,-(SP)
    RTE
RESUME:
    MOVE.L  RESUMEN,D0
    ADDQ.L  #1,RESUMEN
    TST.L   D0
    BNE     SECOND
    LEA     $7FFE,A1
    MOVEQ   #13,D0
    TRAP    #15
SECOND:
    MOVE.B  #0,$9000            ; the byte after the range: no error
    MOVE.L  COUNT,D1
    LEA     CNT,A1
    JSR     DMP_VAL
    JSR     DMP_CLOSE
    SIMHALT
COUNT   DC.L 0
RESUMEN DC.L 0
CNT     DC.B 'count',0
    INCLUDE '..\dumplib.X68'
    ORG     $7FFE
    DC.B    'ABC',0
    END     START