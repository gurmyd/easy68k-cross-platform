M	MACRO
	AND.B #%00001111,D0 ; 50% done
	DC.B '%d%s%%'
	ENDM
	ORG $1000
	M
	END $1000
