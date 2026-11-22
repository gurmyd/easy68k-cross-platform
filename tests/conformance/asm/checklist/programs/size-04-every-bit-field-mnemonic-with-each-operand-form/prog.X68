* Every bit-field mnemonic with each form of {offset:width}; switched off by
* Assemble Bit Field Instructions they are all invalid opcodes (assembler 2)
	ORG	$1000
START	BFCHG	D0{0:32}
	BFCLR	(A0){#5:#3}
	BFEXTS	(4,A1){D1:8},D2
	BFEXTU	$2000{31:1},D3
	BFFFO	D4{D5:D6},D7
	BFINS	D1,(A2){3:4}
	BFINS	D2,D3{0:8}
	BFSET	$12345678{7:D0}
	BFTST	(-6,A4,D1.W){2:30}
	BFTST	(LOOP,PC){1:2}
* spaces after { and around :
	BFTST	D0{ 2 : 4}
* width 33 is not a bit field
	BFTST	D0{2:33}
LOOP	BFEXTU	D0{2:4},D1
	BRA	LOOP
	END	START
