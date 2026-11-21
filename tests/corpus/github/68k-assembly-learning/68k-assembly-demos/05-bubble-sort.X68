*-----------------------------------------------------------
* Title      : bubble-sort
* Written by : Henry Wrightson
* Date       : 12/8/2026
* Description: Bubble sort a list of strings into alphabetical order
*-----------------------------------------------------------
    org     $1000
    
; d7=word count     d1=sorted to    d2=current word
; a0=word list      a1=word index
    
Start:

    lea     Words,a0
    lea     WordIndex,a1
    
    jsr     CountWords
    
    jsr     OutputUnsortedWords
    jsr     SortWords
    jsr     OutputSortedWords
    
    bra.w   Finished

SortWords:
    moveq   #0,d1
.OuterLoop:
    addq    #1,d1
    cmp.b   d7,d1
    beq.w   .Finished
    
    move.b  d7,d2
    
.InnerLoop:
    cmp.b   d1,d2
    beq.s   .OuterLoop
  
    jsr     CompareWords
    
    subq    #1,d2
    bra.s   .InnerLoop
.Finished:
    rts

CountWords:                 ; count the number of words in a table
    move.l  a0,-(sp)
    move.l  a1,-(sp)
    moveq   #0,d7
.Loop:
    tst.b   (a0)
    beq.s   .Done
    move.l  a0,(a1)+
    addq.w  #1,d7
.NextWord:                  ; move to the end of the word
    tst.b   (a0)+
    bne.s   .NextWord    
    bra.s   .Loop
.Done:
    move.l  (sp)+,a1
    move.l  (sp)+,a0
    rts
    
CompareWords:               ; with d2 as the current word to sort, compare it with the previous word
    move.w  d2,d0
    subq    #1,d0
    
    lsl.w   #2,d0
    movea.l (a1,d0.w),a4    ; current words letter
    subq    #4,d0
    movea.l (a1,d0.w),a3    ; previous words letter
.Loop:                      ; loop through the letters of the words until a difference is found
    move.b  (a3),d3         ; left letter
    move.b  (a4),d4         ; right letter
    move.b  d4,d0
    or.b    d3,d0           ; both letters are 0, end of word reached, both the same word, no change
    beq.s   .Done
    
    cmp.b   d3,d4           ; both letters are the same, next letter
    beq.s   .Next
    
    tst.b   d3              ; left letter is 0, left word is shorter, no change
    beq.s   .Done
    
    cmp.b   d4,d3           ; right letter is lower than left, no change
    blo.s   .Done
.Switch:                    ; failed all previous checks so words should be switched
    move.w  d2,d0
    subq    #1,d0           
    lsl.w   #2,d0           ; right word index
    move.l  (a1,d0.w),d4    ; cache right word index address in d4
    
    subq    #4,d0           ; left word index
    move.l  (a1,d0.w),d3    ; cache left word index address in d3
    move.l  d4,(a1,d0.w)    ; move cached right word index address in d4 to left word index address
    
    move.w  d2,d0
    subq    #1,d0           
    lsl.w   #2,d0           ; right word index
    move.l  d3,(a1,d0.w)    ; move cached left word index address in d3 to right word index address

    bra.s   .Done
.Next:
    addq    #1,a3
    addq    #1,a4
    bra.s   .Loop
.Done:
    rts

OutputUnsortedWords:
    lea     MessageIntro,a3
    jsr     OutputList
    rts

OutputSortedWords:
    jsr     OutputNewLine
    lea     MessageSortedList,a3
    jsr     OutputList
    rts
    
OutputList:    
    move.l  a1,-(sp)
    movea.l a1,a2

    movea.l a3,a1
    moveq   #13,d0
    trap    #15
    
    moveq   #0,d6
.Loop:    
    cmp.b   d7,d6
    beq.s   .Done    
.Continue:
    move.l  (a2),a1
    moveq   #13,d0
    trap    #15
    
    addq    #4,a2
    addq    #1,d6
    bra.s   .Loop
.Done:
    move.l  (sp)+,a1
    rts

OutputNewLine:
    moveq   #6,d0
    move.b  #13,d1
    trap    #15
    move.b  #10,d1
    trap    #15
    rts
    
Finished:
    simhalt

MAX_WORDS           equ     200
MessageIntro        dc.b    'This is a list of words',0
MessageSortedList   dc.b    'Now they are sorted alphabetically',0
Evener              dc.b    0

Words:
    dc.b    'the',0
    dc.b    'quick',0
    dc.b    'brown',0
    dc.b    'fox',0
    dc.b    'jumps',0
    dc.b    'over',0
    dc.b    'the',0
    dc.b    'lazy',0
    dc.b    'dog',0
    dc.b    $0,0

WordIndex:
    ds.l    MAX_WORDS

    end     Start

*~Font name~Courier New~
*~Font size~10~
*~Tab type~1~
*~Tab size~4~
