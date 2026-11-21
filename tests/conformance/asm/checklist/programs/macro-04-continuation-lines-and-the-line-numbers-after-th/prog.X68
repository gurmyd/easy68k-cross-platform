M	MACRO
	DC.B \1,\2,\3
	ENDM
	ORG $1000
	M 1,
& 2,
& 3
	M 4,
no ampersand
	MOVE.B #300,D0
	END $1000
