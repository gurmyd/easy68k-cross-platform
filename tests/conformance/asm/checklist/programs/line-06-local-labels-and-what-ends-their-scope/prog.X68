	ORG $1000
MAIN	NOP
.loop	BRA .loop
VAL	EQU 5
.a	NOP
	BRA .a
M	MACRO
.x	NOP
	ENDM
.y	NOP
	M
	END $1000
