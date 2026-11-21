	ORG	$1000
START	MOVE.W	D0,D1	tab separated
START2  MOVE.W  D0,D1   space separated
	DC.B	'a	b'	tab inside a string
 	NOP
  NOP
	END	START
