*-----------------------------------------------------------
* Title      : bitfield - 68020 bit field instructions (an EASy68K option)
* Written by : easy68k-mac project (test fixture, GPL-2.0-or-later)
* Description: OPT BIT makes the assembler accept the instructions and
*              write the simulator directive for bit fields into the
*              listing, which turns the option on when the program is
*              loaded.  Each case records SR (word) and a long at (A6)+.
*-----------------------------------------------------------
        OPT     BIT
REC     MACRO                   record SR, then the long \1
        MOVE    SR,(A6)+
        MOVE.L  \1,(A6)+
        ENDM

        ORG     $1000
START:  LEA     RESULTS,A6
        LEA     MEM,A0
        MOVE.L  #$12345678,D0
        MOVE    #$1F,CCR
        BFEXTU  D0{8:8},D1              1  bits 8..15 counted from the left: $34
        REC     D1
        BFEXTS  D0{0:4},D1              2  $1 -> 1
        REC     D1
        MOVE.L  #$F0000000,D0
        BFEXTS  D0{0:4},D1              3  $F sign-extended: -1, N
        REC     D1
        BFTST   D0{4:8}                 4  zero field: Z
        REC     D0
        BFSET   D0{28:4}                5  $F000000F
        REC     D0
        BFCLR   D0{0:4}                 6  $0000000F
        REC     D0
        BFCHG   D0{24:8}                7  $000000F0
        REC     D0
        MOVEQ   #5,D2
        BFINS   D2,D0{0:4}              8  $500000F0
        REC     D0
        MOVE.L  #$00100000,D0
        BFFFO   D0{0:32},D1             9  first one bit: offset 11
        REC     D1
        MOVE.L  #$00000000,(A0)
        MOVE.L  #$00000000,4(A0)
        BFSET   (A0){4:8}               10 memory: bytes 0F F0 00 00
        REC     (A0)
        BFEXTU  (A0){4:8},D1            11 $FF
        REC     D1
        BFINS   D2,(A0){30:4}           12 field crosses into the fifth byte
        REC     (A0)
        REC     4(A0)                   13
        MOVE.L  #$01020304,8(A0)
        MOVE.L  #$05060708,12(A0)
        MOVEQ   #-1,D2
        BFINS   D2,8(A0){4:32}          14 the fifth byte receives the old second byte (original bug)
        REC     8(A0)
        REC     12(A0)                  15
        SIMHALT

        ORG     $3000
MEM     DS.B    16

        ORG     $4000
RESULTS DS.B    6*20

        END     START
