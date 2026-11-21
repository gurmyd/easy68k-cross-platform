*-----------------------------------------------------------
* Title      : reverse-word
* Written by : Henry Wrightson
* Date       : 9/8/2026
* Description: Put a word into memory, reverse it in memory and output
*-----------------------------------------------------------
    ORG    $1000    
START:
    lea     buffer,a1
    moveq   #4,d0
    
Loop:
    MOVE.B  message(PC,D0.W),D2
    MOVE.B  D2,(A1,D1.W)
    ADDQ    #1,D1
    SUBQ    #1,D0
    BPL     Loop
    MOVE.B  message+5,D2
    MOVE.B  D2,5(A1)
    
    MOVE.B  #14,D0
    TRAP    #15

    SIMHALT
    
message     dc.b    'Hello',0
buffer      ds.b    5
    
    END    START

*~Font name~Courier New~
*~Font size~10~
*~Tab type~1~
*~Tab size~4~
