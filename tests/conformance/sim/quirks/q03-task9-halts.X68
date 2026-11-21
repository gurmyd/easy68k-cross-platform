* @item trap15-a 4 task 9: terminates like SIMHALT (the file is closed first;
* @item the instruction after the TRAP is never reached)
    ORG     $1000
START:
    JSR     DMP_OPEN
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    MOVEQ   #9,D0
    TRAP    #15
    JSR     DMP_OPEN
    LEA     NEVER,A1
    JSR     DMP_TEXT
    JSR     DMP_CLOSE
    SIMHALT
NEVER DC.B  'reached after task 9',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START