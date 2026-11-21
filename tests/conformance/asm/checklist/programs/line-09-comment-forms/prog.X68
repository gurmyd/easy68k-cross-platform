* star comment
; semicolon comment
   * indented star
	ORG $1000
L1 ; after label
L2 * after label
	NOP anything goes here
	MOVE.L #1 + 2,D0
	NOP;x
	END $1000
