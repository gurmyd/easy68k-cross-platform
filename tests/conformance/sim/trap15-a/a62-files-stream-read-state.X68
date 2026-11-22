* @item STDIO-MODEL.md R8 R9 R10: task 54 right after task 53 without a seek: a write into
* @item the read buffer that never reaches the file, a write of 600 at the end of the
* @item read-ahead block, a write after a read that emptied the buffer or hit the end
* @owner engine
* @timeout 400
PNEW    MACRO
        LEA     \1,A1
        BSR     P_NEW
        ENDM
POPEN   MACRO
        LEA     \1,A1
        BSR     P_OPEN
        ENDM
PWR     MACRO
        LEA     \1,A1
        MOVE.L  #\2,D2
        BSR     P_WR
        ENDM
PRD     MACRO
        MOVE.L  #\1,D2
        MOVE.L  #\2,D3
        BSR     P_RD
        ENDM
PSK     MACRO
        MOVE.L  #\1,D2
        BSR     P_SK
        ENDM
PCL     MACRO
        BSR     P_CL
        ENDM
PDEL    MACRO
        LEA     \1,A1
        BSR     P_DEL
        ENDM
PEX     MACRO
        LEA     \1,A1
        BSR     P_EX
        ENDM
PBACK   MACRO
        LEA     \1,A1
        MOVE.L  #\2,D3
        BSR     P_BACK
        ENDM
PKEEP   MACRO
        MOVE.L  P_FID,P_FIDS+4*\1
        ENDM
PUSE    MACRO
        MOVE.L  P_FIDS+4*\1,P_FID
        ENDM
PNOTE   MACRO
        LEA     \1,A1
        JSR     DMP_TEXT
        ENDM
PDUMP   MACRO
        LEA     \1,A0
        MOVE.L  #\2,D0
        JSR     DMP_MEM
        ENDM
PMAKE   MACRO
        PNEW    \1
        PWR     \2,\3
        PCL
        ENDM
    ORG     $1000
START:
    JSR     DMP_OPEN
    BSR     P_INIT
    PNOTE   TA
    PMAKE   FA,ABCDE,10
    POPEN   FA
    PRD     2,2
    PWR     XYZW,2
    PRD     3,3
    PRD     10,3
    PRD     1,1
    PCL
    PBACK   FA,16
    PNOTE   TB
    PMAKE   FB,ABCDE,10
    POPEN   FB
    PRD     2,2
    PWR     ONES,600
    PRD     3,3
    PCL
    PBACK   FB,16
    PDUMP   P_BBUF+600,16
    PNOTE   TC
    PMAKE   FC,ABCDE,10
    POPEN   FC
    PRD     2,2
    PWR     XYZW,2
    PSK     0
    PRD     10,10
    PCL
    PBACK   FC,16
    PNOTE   TD
    PMAKE   FD,ABCDE,10
    POPEN   FD
    PRD     20,12
    PWR     XYZW,2
    PCL
    PBACK   FD,16
    PNOTE   TE
    PMAKE   FE,P_PAT,300
    POPEN   FE
    PRD     100,0
    PRD     200,0
    PWR     XYZW,2
    PCL
    PBACK   FE,0
    PDUMP   P_BBUF+296,8
    PNOTE   TF
    PMAKE   FF,ABCDE,10
    POPEN   FF
    PWR     XYZW,2
    PCL
    PBACK   FF,16
    PNOTE   TG
    PMAKE   FG,ABCDE,10
    POPEN   FG
    PRD     2,2
    PWR     XYZW,2
    PSK     4
    PRD     3,3
    PCL
    PBACK   FG,16
    PNOTE   TH
    PMAKE   FH,ABCDE,10
    POPEN   FH
    PRD     2,2
    PWR     XYZW,4
    PRD     2,2
    PWR     LOWER,2
    PCL
    PBACK   FH,16
    JSR     DMP_CLOSE
    SIMHALT
TA  DC.B    'A file 10: read 2, write 2, read 3, read 10, read 1, close',0
TB  DC.B    'B file 10: read 2, write 600, read 3, close',0
TC  DC.B    'C file 10: read 2, write 2, seek 0, read 10, close',0
TD  DC.B    'D file 10: read 20, write 2, close',0
TE  DC.B    'E file 300: read 100, read 200, write 2, close',0
TF  DC.B    'F file 10: open, write 2, close',0
TG  DC.B    'G file 10: read 2, write 2, seek 4, read 3, close',0
TH  DC.B    'H file 10: read 2, write 4, read 2, write 2, close',0
FA  DC.B    'ra.bin',0
FB  DC.B    'rb.bin',0
FC  DC.B    'rc.bin',0
FD  DC.B    'rd.bin',0
FE  DC.B    're.bin',0
FF  DC.B    'rf.bin',0
FG  DC.B    'rg.bin',0
FH  DC.B    'rh.bin',0
    DS.W    0

P_NEW:  MOVEQ   #52,D0
        TRAP    #15
        MOVE.L  D1,P_FID
        LEA     P_TNEW,A2
        BRA     P_REC
P_OPEN: MOVEQ   #51,D0
        TRAP    #15
        MOVE.L  D1,P_FID
        LEA     P_TOPEN,A2
        BRA     P_REC
P_WR:   MOVE.L  P_FID,D1
        MOVEQ   #54,D0
        TRAP    #15
        LEA     P_TWR,A2
        BRA     P_REC
P_RD:   LEA     P_RBUF,A0
        MOVE.W  #P_BUFLEN-1,D0
P_RDF:  MOVE.B  #$EE,(A0)+
        DBRA    D0,P_RDF
        MOVE.L  P_FID,D1
        LEA     P_RBUF,A1
        MOVEQ   #53,D0
        TRAP    #15
        LEA     P_TRD,A2
        BSR     P_REC
        TST.L   D3
        BEQ.S   P_RDX
        MOVEM.L D0/A0,-(SP)
        LEA     P_RBUF,A0
        MOVE.L  D3,D0
        JSR     DMP_MEM
        MOVEM.L (SP)+,D0/A0
P_RDX:  RTS
P_SK:   MOVE.L  P_FID,D1
        MOVEQ   #55,D0
        TRAP    #15
        LEA     P_TSK,A2
        BRA     P_REC
P_CL:   MOVE.L  P_FID,D1
        MOVEQ   #56,D0
        TRAP    #15
        LEA     P_TCL,A2
        BRA     P_REC
P_DEL:  MOVEQ   #57,D0
        TRAP    #15
        LEA     P_TDEL,A2
        BRA     P_REC
P_EX:   MOVEQ   #59,D0
        TRAP    #15
        LEA     P_TEX,A2
        BRA     P_REC
P_BACK: MOVE.L  A1,-(SP)
        LEA     P_BBUF,A0
        MOVE.W  #P_BUFLEN-1,D0
P_BKF:  MOVE.B  #$EE,(A0)+
        DBRA    D0,P_BKF
        MOVE.L  (SP)+,A1
        MOVEQ   #51,D0
        TRAP    #15
        MOVE.L  D1,P_FIDB
        LEA     P_BBUF,A1
        MOVE.L  #P_BUFLEN,D2
        MOVEQ   #53,D0
        TRAP    #15
        LEA     P_TBK,A2
        BSR     P_REC
        TST.L   D3
        BEQ.S   P_BKC
        LEA     P_BBUF,A0
        MOVE.L  D3,D0
        JSR     DMP_MEM
P_BKC:  MOVE.L  P_FIDB,D1
        MOVEQ   #56,D0
        TRAP    #15
        LEA     P_TBC,A2
        BRA     P_REC

P_REC:  MOVEM.L D0-D7/A0-A6,P_SAVE
        MOVEA.L A2,A1
        BSR     DMP_PUTS0
        LEA     P_TD0,A1
        BSR     DMP_PUTS0
        MOVE.L  P_SAVE,D3
        MOVEQ   #8,D4
        BSR     DMP_HEX
        LEA     P_TD1,A1
        BSR     DMP_PUTS0
        MOVE.L  P_SAVE+4,D3
        MOVEQ   #8,D4
        BSR     DMP_HEX
        LEA     P_TD2,A1
        BSR     DMP_PUTS0
        MOVE.L  P_SAVE+8,D3
        MOVEQ   #8,D4
        BSR     DMP_HEX
        BSR     DMP_FLUSH
        MOVEM.L P_SAVE,D0-D7/A0-A6
        RTS

P_INIT: LEA     P_PAT,A0
        MOVEQ   #1,D1
        MOVE.W  #P_PATLEN-1,D0
P_INL:  MOVE.B  D1,(A0)+
        ADDQ.B  #1,D1
        CMP.B   #252,D1
        BNE.S   P_INN
        MOVEQ   #1,D1
P_INN:  DBRA    D0,P_INL
        RTS

P_BUFLEN EQU    1200
P_PATLEN EQU    1200
P_TNEW  DC.B    'new',0
P_TOPEN DC.B    'open',0
P_TWR   DC.B    'wr',0
P_TRD   DC.B    'rd',0
P_TSK   DC.B    'sk',0
P_TCL   DC.B    'cl',0
P_TDEL  DC.B    'del',0
P_TEX   DC.B    'ex',0
P_TBK   DC.B    'bk',0
P_TBC   DC.B    'bc',0
P_TD0   DC.B    ' D0=',0
P_TD1   DC.B    ' D1=',0
P_TD2   DC.B    ' D2=',0
ABCDE   DC.B    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
LOWER   DC.B    'abcdefghijklmnopqrstuvwxyz'
XYZW    DC.B    'XYZW'
ONES    DCB.B   1100,'1'
        DS.W    0
P_FID   DC.L    0
P_FIDB  DC.L    0
P_FIDS  DS.L    8
P_SAVE  DS.L    16
P_RBUF  DS.B    P_BUFLEN
P_BBUF  DS.B    P_BUFLEN
P_PAT   DS.B    P_PATLEN
        DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START
