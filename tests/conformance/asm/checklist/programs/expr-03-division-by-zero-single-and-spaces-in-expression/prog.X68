	ORG $1000
	DC.W 1/0
	DC.W 1\0
	DC.W 2>1
	MOVE.W #(1 + 2),D0
	MOVE.W #1 + 2,D0
	MOVE.W ( 4, A0 ),D0
	MOVE.W 12( A0 ),D0
	END $1000
