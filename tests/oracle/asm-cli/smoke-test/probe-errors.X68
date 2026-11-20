* Error-path probe: undefined symbol, bad opcode, range errors, missing END
        ORG     $1000
START   MOVE.W  UNDEF,D0
        FROB    D0,D1
        MOVEQ   #300,D2
        BRA.S   FAR
        ADDQ.W  #9,D3
DUP     NOP
DUP     NOP
        DS.B    300
FAR     MOVE.B  #$1234,D4
        DC.B    1,2,
        IF.W D0 <EQ> D1 THEN
        NOP
