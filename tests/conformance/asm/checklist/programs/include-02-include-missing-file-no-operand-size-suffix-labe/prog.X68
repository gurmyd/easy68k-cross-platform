	ORG $1000
	INCLUDE missing.x68
	INCLUDE
	INCLUDE.W inc1.x68
L	INCLUDE inc1.x68
	INCLUDE inc1.x68	comment
	BRA L
	END $1000
