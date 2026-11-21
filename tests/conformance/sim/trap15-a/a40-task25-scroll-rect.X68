* @item trap15-a 4 task 25: scroll a text rectangle up, down, left and right by
* @item one cell (text array as task 22 reads it); requests with r+h >= 128,
* @item c+w >= 256, a zero width or height, or another direction do nothing
    ORG     $1000
START:
    JSR     DMP_OPEN
    BSR     FILL
    LEA     CASES,A3
LOOP:
    MOVE.L  (A3)+,D1
    MOVE.L  (A3)+,D2
    MOVE.W  (A3)+,D3
    CMP.W   #$7F,D3
    BEQ     DONE
    MOVEQ   #25,D0
    TRAP    #15
    BSR     SHOW
    BRA     LOOP
DONE:
    JSR     DMP_CLOSE
    SIMHALT
* rows 0-5: 'abcdefgh' 'ijklmnop' ... at columns 0-7
FILL:
    MOVEQ   #0,D5
    MOVE.B  #'a',D4
FILLR:
    MOVE.W  D5,D1
    MOVEQ   #11,D0
    TRAP    #15
    MOVEQ   #7,D6
FILLC:
    MOVE.B  D4,D1
    MOVEQ   #6,D0
    TRAP    #15
    ADDQ.B  #1,D4
    CMP.B   #'z'+1,D4
    BNE     FILLN
    MOVE.B  #'A',D4
FILLN:
    DBRA    D6,FILLC
    ADDQ.W  #1,D5
    CMP.W   #6,D5
    BNE     FILLR
    RTS
SHOW:
    MOVEQ   #0,D5
SHOWR:
    MOVE.W  D5,D1
    MOVE.W  #9,D2
    JSR     DMP_ROW
    ADDQ.W  #1,D5
    CMP.W   #6,D5
    BNE     SHOWR
    RTS
* D1 (row<<16 | col), D2 (height<<16 | width), D3.W direction
CASES DC.L  $00010001,$00030004
      DC.W  0
      DC.L  $00010001,$00030004
      DC.W  1
      DC.L  $00000002,$00040003
      DC.W  2
      DC.L  $00000002,$00040003
      DC.W  3
      DC.L  $007E0000,$00020004
      DC.W  0
      DC.L  $000000FE,$00020002
      DC.W  0
      DC.L  $00000000,$00000004
      DC.W  0
      DC.L  $00000000,$00040004
      DC.W  4
      DC.L  0,0
      DC.W  $7F
    INCLUDE '..\dumplib.X68'
    END     START