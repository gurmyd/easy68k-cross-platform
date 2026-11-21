	ORG $1000
DATA	INCBIN 'data.bin'
	INCBIN nothere.bin
	NOP
	LEA DATA,A0
	END $1000
