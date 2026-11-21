*-----------------------------------------------------------
* Title      : plot-digits
* Written by : Henry Wrightson
* Date       : 28/8/2026
* Type       : Program file
* Description: Plot a number with a bitmask font
*-----------------------------------------------------------
    org     $1000
    
    include 'macros.X68'

Start:
    
    jsr     Test
    bsr     Finish
    
    include 'code.X68'

Finish:
    simhalt

    include 'variables.X68'

    end     Start

*~Font name~Courier New~
*~Font size~10~
*~Tab type~1~
*~Tab size~4~
