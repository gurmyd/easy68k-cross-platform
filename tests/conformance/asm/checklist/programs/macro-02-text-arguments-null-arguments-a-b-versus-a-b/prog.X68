M	MACRO
	DC.B NARG
	DC.B '\1'
	ENDM
	ORG $1000
	M <1,2>
	M <A<B>C>
	M <<GT>>
	M 'IT''S'
	M A, B
	M A ,B
	M '',X
	M this is a comment
	END $1000
