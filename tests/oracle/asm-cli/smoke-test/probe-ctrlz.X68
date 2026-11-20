* Ctrl-Z probe: the Windows CRT stops reading a text-mode file at 0x1A
        ORG     $1000
START   MOVEQ   #1,D0
        MOVEQ   #2,D1
        MOVEQ   #3,D2
        SIMHALT
        END     START
