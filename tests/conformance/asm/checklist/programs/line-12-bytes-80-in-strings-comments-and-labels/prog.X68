	ORG $1000
	DC.B 'éè'	; café
	DC.W 'Aé'
	MOVE.W #'Aé',D0
ÉT	NOP
	END $1000
