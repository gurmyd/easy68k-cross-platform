*-----------------------------------------------------------
* Title      : ai-bubble-sort
* Written by : chatGPT
* Date       : 13/8/2026
* Description: Created by chatGPT with this prompt
*              Create a 68k assembly code program that will run in EASy68K to bubble sort the following list of words into ascending alphabetical order. The list of words is;
*              
*              the
*              quick
*              brown
*              fox
*              jumps
*              over
*              the
*              lazy
*              dog
*
*              Assume you do not know what the words are or how many at assembly time, so you will have to bulid any word pointer lists at runtime.
*
*              Output the word list at the beginning with a intro messaage saying 'This is a list of words'. Then output the sorted list at the end with the message 'Now they are sorted' 'Now they are sorted'.
*-----------------------------------------------------------
        ORG     $1000

START:
        ; -----------------------------------------
        ; Clear screen
        ; -----------------------------------------

        MOVEQ   #11,D0
        MOVE.W  #$FF00,D1
        TRAP    #15


        ; -----------------------------------------
        ; Build pointer table at runtime
        ; -----------------------------------------

        LEA     Words,A0
        LEA     WordIndex,A1

BuildIndex:
        TST.B   (A0)
        BEQ.S   IndexDone

        MOVE.L  A0,(A1)+

FindEnd:
        TST.B   (A0)+
        BNE.S   FindEnd

        BRA.S   BuildIndex


IndexDone:
        MOVE.L  #0,(A1)+


        ; -----------------------------------------
        ; Print original list
        ; -----------------------------------------

        LEA     IntroMsg,A1
        BSR     PrintString
        BSR     CRLF

        LEA     WordIndex,A0
        BSR     PrintList


        ; -----------------------------------------
        ; Bubble sort pointer table
        ; -----------------------------------------

        BSR     BubbleSort


        ; -----------------------------------------
        ; Print sorted list
        ; -----------------------------------------

        BSR     CRLF

        LEA     SortedMsg,A1
        BSR     PrintString
        BSR     CRLF

        LEA     WordIndex,A0
        BSR     PrintList


        ; -----------------------------------------
        ; Exit
        ; -----------------------------------------

        MOVEQ   #9,D0
        TRAP    #15


; =================================================
; PrintList
;
; A0 -> pointer table
; table terminated by zero
; =================================================

PrintList:
        MOVE.L  (A0)+,D0
        BEQ.S   PrintListDone

        MOVEA.L D0,A1
        BSR     PrintString
        BSR     CRLF

        BRA.S   PrintList

PrintListDone:
        RTS


; =================================================
; BubbleSort
;
; WordIndex contains pointers to the strings.
; We first count the entries in the table.
; =================================================

BubbleSort:

        ; -----------------------------------------
        ; Count words in WordIndex
        ; -----------------------------------------

        LEA     WordIndex,A0
        MOVEQ   #0,D7

CountWords:
        MOVE.L  (A0)+,D0
        BEQ.S   CountDone

        ADDQ.W  #1,D7
        BRA.S   CountWords


CountDone:
        ; D7 = number of words
        ;
        ; Need N-1 passes.
        SUBQ.W  #1,D7

        TST.W   D7
        BLE.S   SortDone


; -----------------------------------------
; Outer loop
; -----------------------------------------

OuterLoop:

        LEA     WordIndex,A0
        MOVE.W  D7,D6

        ; DBRA performs count+1 iterations,
        ; so reduce the count by one.
        SUBQ.W  #1,D6


; -----------------------------------------
; Inner loop
; -----------------------------------------

InnerLoop:

        MOVEA.L (A0),A1
        MOVEA.L 4(A0),A2

        BSR     CompareStrings

        ; D0 > 0 means first word is alphabetically
        ; AFTER the second word, so swap them.

        TST.W   D0
        BLE.S   NoSwap

        MOVE.L  (A0),D1
        MOVE.L  4(A0),D2

        MOVE.L  D2,(A0)
        MOVE.L  D1,4(A0)


NoSwap:
        ADDQ.L  #4,A0

        DBRA    D6,InnerLoop

        SUBQ.W  #1,D7
        BGT.S   OuterLoop


SortDone:
        RTS

; =================================================
; CompareStrings
;
; A1 -> first string
; A2 -> second string
;
; Returns:
;   D0 < 0  first before second
;   D0 = 0  equal
;   D0 > 0  first after second
; =================================================

CompareStrings:

CompareLoop:
        MOVE.B  (A1)+,D1
        MOVE.B  (A2)+,D2

        CMP.B   D2,D1
        BNE.S   CharactersDifferent

        TST.B   D1
        BEQ.S   StringsEqual

        BRA.S   CompareLoop


CharactersDifferent:
        EXT.W   D1
        EXT.W   D2
        SUB.W   D2,D1
        MOVE.W  D1,D0
        RTS


StringsEqual:
        MOVEQ   #0,D0
        RTS


; =================================================
; PrintString
; =================================================

PrintString:
        MOVEQ   #14,D0
        TRAP    #15
        RTS


; =================================================
; CRLF
; =================================================

CRLF:
        MOVEQ   #6,D0
        MOVE.B  #13,D1
        TRAP    #15

        MOVE.B  #10,D1
        TRAP    #15
        RTS

        SIMHALT

; =================================================
; Messages
; =================================================

IntroMsg:
        DC.B    'This is a list of words',0

SortedMsg:
        DC.B    'Now they are sorted',0


; =================================================
; Runtime pointer table
;
; IMPORTANT:
; The program does NOT know how many words
; there are when assembled.
;
; Reserve space for up to 100 words.
; =================================================

WordIndex:
        DS.L    101


; =================================================
; Input data
;
; The program discovers where each word starts
; and builds WordIndex at runtime.
; =================================================

Words:
        DC.B    'the',0
        DC.B    'quick',0
        DC.B    'brown',0
        DC.B    'fox',0
        DC.B    'jumps',0
        DC.B    'over',0
        DC.B    'the',0
        DC.B    'lazy',0
        DC.B    'dog',0
        DC.B    0
        
        end     Start

*~Font name~Courier New~
*~Font size~10~
*~Tab type~1~
*~Tab size~4~
