*-----------------------------------------------------------
* Title      : ticking-digits
* Written by : Henry Wrightson
* Date       : 11/8/2026
* Description: Use the Hardware window to view the LED digits
*            : counting from 0 to 9
*-----------------------------------------------------------
    ORG    $1000
    
DELAY    MACRO
    move.b  #23,d0          trap task 23
    move.l  #\1,d1          delay amount
    trap    #15
    ENDM

START:                  ; first instruction of program
    
    move.l  #0,$00E00000
    move.l  #0,$00E00004
    move.l  #0,$00E00008
    move.l  #0,$00E0000C
    lea     $00E0000E,a0
    lea     DisplayDigits,a1
loop:
    move.b  #23,d0           ; trap task 23
    move.l  #50,d1           ; delay amount
    trap    #15
    
    move.b  (a1,d2.w),d1
    move.b  d1,(a0)
    
    addi.b  #1,d2
    cmp.b   #10,d2
    bne     Continue
    moveq   #0,d2
Continue:
    bra     Loop

    SIMHALT             ; halt simulator

;                       0  1 2  3  4   5   6   7 8   9
DisplayDigits:  dc.b    63,6,91,79,102,109,125,7,127,103
    

    END    START        ; last line of source


;     1
;     -
; 32 | | 2
; 64  -
; 16   | 4
;     
;     8

*~Font name~Courier New~
*~Font size~10~
*~Tab type~1~
*~Tab size~4~
