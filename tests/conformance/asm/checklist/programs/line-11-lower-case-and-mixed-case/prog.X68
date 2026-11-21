	org $1000
start	move.l #$ff,d0
	Move.W D0,D1
	dc.b 'aB',"x"
	end start
