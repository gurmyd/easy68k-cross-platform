	ORG	$1000
M0	MACRO
	DC.W	NARG	count NARG here
	ENDM
	M0
	M0	* a comment
	M0	; a comment
	M0	comment words
	M0	A,B	two arguments
	END	$1000
