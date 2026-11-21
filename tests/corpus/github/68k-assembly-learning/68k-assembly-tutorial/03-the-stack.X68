    org     $1000
Start:

    move.w #1,-(sp) ; push to the stack. stack pointer always moves down
    move.w (sp)+,d1 ; pop off the stack. always remember to move the pointer back up when popping
    
    simhalt

    end     Start
    
*~Font name~Courier New~
*~Font size~10~
*~Tab type~1~
*~Tab size~4~
