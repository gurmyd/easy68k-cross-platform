	ORG	$1000
MAIN	NOP
.a	NOP
	BRA	.a
V	SET	1
.a	NOP
	BRA	.a
V	SET	2
.b	NOP
	IF.W D0 <EQ> D1 THEN
.c	NOP
	ENDI
	BRA	.b
	BRA	.c
NEXT	NOP
.a	NOP
	BRA	.a
	END	MAIN
