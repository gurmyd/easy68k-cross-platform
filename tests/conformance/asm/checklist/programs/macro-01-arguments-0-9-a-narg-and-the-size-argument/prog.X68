M	MACRO
	DC.\0 \1,\2,\A
L\@	DC.B NARG
	ENDM
	ORG $1000
	M 1,2,3,4,5,6,7,8,9,10
	M.B 3,4
	M.L 5
	M.S 6
	M
	END $1000
