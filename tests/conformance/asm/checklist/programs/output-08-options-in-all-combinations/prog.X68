	ORG	$1000
CR	EQU	$0D
PRINT	MACRO
	LEA	\1,A1
	MOVE.B	#14,D0
	TRAP	#15
	ENDM
START	PRINT	MSG
	IF.W D0 <EQ> #1 THEN
	ADDQ.W	#1,D1
	ENDI
	BFTST	D0{2:4}
	DC.B	1
	DC.W	$1234
	ORG	$1101
MSG	DC.B	'A long string constant that does not fit the object field',CR,0
	DC.L	1,2,3,4,5
	SIMHALT
	END	START
