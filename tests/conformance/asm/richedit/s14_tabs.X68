    ORG     $1000
START:
	NOP		; tab separated
LBL:	MOVE.L	#1,D0	* c
    NOP   	  
    SIMHALT
    END     START
