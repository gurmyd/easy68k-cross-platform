*-----------------------------------------------------------
* Title      : io - TRAP #15 tasks at the engine / host boundary
* Written by : easy68k-mac project (test fixture, GPL-2.0-or-later)
* Description: The test puts a case number in D7 and runs.  Case n is the
*              code at $2000 + n*$80.  Results that the test checks are
*              stored with (A6)+ in RESULTS.  test/io.test.mjs asserts.
*-----------------------------------------------------------
T15     MACRO                   TRAP #15 task \1
        MOVEQ   #\1,D0
        TRAP    #15
        ENDM

        ORG     $1000
START:  LEA     RESULTS,A6
        LSL.W   #7,D7
        LEA     $2000,A0
        JMP     0(A0,D7.W)

        ORG     $2000           case 0: text output, tasks 14 13 0 1 6
        LEA     TABC,A1
        T15     14              "ABC"
        LEA     TDEF,A1
        T15     13              "DEF" CR LF
        LEA     TGHIJK,A1
        MOVE.L  #$FFFF0003,D1   only D1.W counts
        T15     0               "GHI" CR LF
        MOVEQ   #2,D1
        T15     1               "GH"
        MOVE.L  #$FFFFFF21,D1   only D1.B counts
        T15     6               "!"
        SIMHALT

        ORG     $2080           case 1: numbers, tasks 3 15 17 20
        MOVE.L  #-12345,D1
        T15     3               "-12345"
        MOVE.L  #255,D1
        MOVEQ   #16,D2
        T15     15              "FF"
        MOVEQ   #5,D1
        MOVEQ   #2,D2
        T15     15              "101"
        MOVE.L  #$FFFFFFFF,D1
        MOVEQ   #10,D2
        T15     15              "4294967295" (unsigned)
        LEA     TNEQ,A1
        MOVEQ   #42,D1
        T15     17              "N=42"
        MOVEQ   #42,D1
        MOVEQ   #6,D2
        T15     20              "    42"
        MOVEQ   #-7,D1
        MOVE.B  #-6,D2
        T15     20              "-7    " (negative width: left justified)
        MOVEQ   #1,D2
        T15     15              radix 1: nothing
        SIMHALT

        ORG     $2100           case 2: task 2, read a string
        LEA     INBUF,A1
        MOVE.L  #$AAAAAAAA,D1
        T15     2
        MOVE.L  D1,(A6)+        length (the whole of D1)
        LEA     INBUF,A1
        T15     14              print it back
        SIMHALT

        ORG     $2180           case 3: task 4, read numbers
        T15     4
        MOVE.L  D1,(A6)+
        T15     4
        MOVE.L  D1,(A6)+
        T15     4
        MOVE.L  D1,(A6)+
        SIMHALT

        ORG     $2200           case 4: task 5 read a character, task 7 key pending?
        MOVE.L  #$AAAAAAAA,D1
        T15     7
        MOVE.L  D1,(A6)+        low byte 0 or 1, upper bits kept
        MOVE.L  #$BBBBBBBB,D1
        T15     5
        MOVE.L  D1,(A6)+        low byte = the key, upper bits kept
        T15     5
        MOVE.L  D1,(A6)+
        SIMHALT

        ORG     $2280           case 5: task 18, prompt then number
        LEA     TNEQ,A1
        T15     18
        MOVE.L  D1,(A6)+
        SIMHALT

        ORG     $2300           case 6: task 12 echo off, then task 2; task 16 prompt / LF options
        MOVEQ   #0,D1
        T15     12
        LEA     INBUF,A1
        T15     2
        MOVE.L  D1,(A6)+
        MOVEQ   #1,D1
        T15     12
        MOVEQ   #2,D1
        T15     16              no LF after CR on character input
        T15     5
        MOVE.L  D1,(A6)+
        SIMHALT

        ORG     $2380           case 7: task 11 cursor
        MOVE.W  #$0A05,D1       column 10, row 5
        T15     11
        MOVEQ   #$58,D1
        T15     6               "X" at (5,10)
        MOVE.L  #$123400FF,D1
        T15     11              get position: D1.W = $0B05, upper word kept
        MOVE.L  D1,(A6)+
        MOVE.L  #$0005000A,D1   task 22: row in the high word, column in the low word
        T15     22              character at row 5, column 10 -> D1.B
        MOVE.L  D1,(A6)+
        MOVE.W  #$FF00,D1
        T15     11              clear screen
        MOVE.L  #$000000FF,D1
        T15     11
        MOVE.L  D1,(A6)+        position after clear: 0
        SIMHALT

        ORG     $2400           case 8: time, cycles, hardware addresses, version
        T15     8
        MOVE.L  D1,(A6)+        centiseconds since midnight
        T15     30              clear cycle counter
        NOP
        T15     31
        MOVE.L  D1,(A6)+        cycles since task 30: NOP (4) + MOVEQ (4)
        MOVEQ   #1,D1
        T15     32
        MOVE.L  D1,(A6)+        7-segment address
        MOVEQ   #2,D1
        T15     32
        MOVE.L  D1,(A6)+        LED address
        MOVEQ   #3,D1
        T15     32
        MOVE.L  D1,(A6)+        switch address
        MOVEQ   #7,D1
        T15     32
        MOVE.L  D1,(A6)+        push-button address
        MOVEQ   #4,D1
        T15     32
        MOVE.L  D1,(A6)+        version
        SIMHALT

        ORG     $2480           case 9: task 23 delay
        LEA     TABC,A1
        T15     14
        MOVEQ   #50,D1
        T15     23              half a second
        LEA     TDEF,A1
        T15     14
        T15     8
        MOVE.L  D1,(A6)+
        SIMHALT

        ORG     $2500           case 10: files
        LEA     FNAME,A1
        T15     52              new file
        MOVE.W  D0,(A6)+
        MOVE.L  D1,D5           file number
        LEA     TGHIJK,A1
        MOVEQ   #5,D2
        MOVE.L  D5,D1
        T15     54              write 5 bytes
        MOVE.W  D0,(A6)+
        MOVE.L  D5,D1
        T15     56              close
        MOVE.W  D0,(A6)+
        LEA     FNAME,A1
        T15     51              open existing
        MOVE.W  D0,(A6)+
        MOVE.L  D1,D5
        LEA     INBUF,A1
        MOVEQ   #10,D2
        T15     53              read up to 10: gets 5
        MOVE.W  D0,(A6)+
        MOVE.L  D2,(A6)+
        MOVE.L  D5,D1
        MOVEQ   #10,D2
        T15     53              at end of file: D0 = 1, D2 unchanged
        MOVE.W  D0,(A6)+
        MOVE.L  D2,(A6)+
        MOVE.L  D5,D1
        MOVEQ   #3,D2
        T15     55              position to 3
        MOVE.W  D0,(A6)+
        MOVE.L  D5,D1
        LEA     INBUF+8,A1
        MOVEQ   #2,D2
        T15     53              reads "JK"
        MOVE.W  D0,(A6)+
        MOVE.L  D5,D1
        MOVEQ   #0,D2
        LEA     TGHIJK,A1
        T15     54              zero-length write: error 2
        MOVE.W  D0,(A6)+
        T15     50              close all
        MOVE.W  D0,(A6)+
        LEA     FNAME,A1
        MOVEQ   #0,D1
        T15     59              exists? 0
        MOVE.W  D0,(A6)+
        LEA     FNAME,A1
        T15     57              delete
        MOVE.W  D0,(A6)+
        LEA     FNAME,A1
        MOVEQ   #0,D1
        T15     59              exists? 2 (error)
        MOVE.W  D0,(A6)+
        LEA     FNAME,A1
        T15     51              open a file that does not exist: D0 = 2, D1 = -1
        MOVE.W  D0,(A6)+
        MOVE.L  D1,(A6)+
        MOVEQ   #9,D1
        T15     56              close a file number that is out of range: 2
        MOVE.W  D0,(A6)+
        SIMHALT

        ORG     $2680           case 13: task 58 file dialog
        LEA     TABC,A1         title
        LEA     TDEF,A2         filter
        LEA     INBUF,A3        path buffer (in and out)
        MOVE.B  #0,(A3)
        MOVEQ   #0,D1           open dialog
        MOVE.L  #$FFFFFF3A,D0   task 58, upper bits set
        TRAP    #15
        MOVE.L  D1,(A6)+        1 = a file was chosen
        MOVE.L  D0,(A6)+        task number is gone: D0.W = 0 (success), upper word kept
        SIMHALT

        ORG     $2700           case 14: task 9 terminate; nothing after it runs
        T15     9
        MOVE.L  #$BAD,(A6)+
        SIMHALT

        ORG     $2780           case 15: key state, key and mouse interrupts, mouse read
        MOVE.L  #$00000041,D1
        T15     19              is 'A' down?
        MOVE.L  D1,(A6)+
        MOVEQ   #0,D1
        T15     19              last key down / up codes
        MOVE.L  D1,(A6)+
        MOVE.L  #$0203,D1       key IRQ level 2 for down and up
        T15     62
        MOVE.L  #$0301,D1       mouse IRQ level 3 for button down
        T15     60
        MOVEQ   #0,D1
        T15     61              current mouse state
        MOVE.L  D0,(A6)+
        MOVE.L  D1,(A6)+
        MOVEQ   #2,D1
        T15     61              state at the last button-down
        MOVE.L  D0,(A6)+
        MOVE.L  D1,(A6)+
        SIMHALT

        ORG     $2800           case 16: graphics, sound, window tasks are forwarded with reduced arguments
        MOVE.L  #$00FF8040,D1
        T15     80              pen colour
        MOVE.L  #$1234FFFE,D1
        MOVE.L  #$56780003,D2
        T15     82              pixel at (-2, 3): only the low words, sign-extended
        MOVEQ   #1,D1
        MOVEQ   #2,D2
        MOVEQ   #3,D3
        MOVEQ   #4,D4
        T15     84              line
        T15     87              rectangle
        MOVE.L  #$11112222,D1
        MOVE.L  #$33334444,D2
        T15     96              pen position: D1.W and D2.W only
        MOVE.L  D1,(A6)+
        MOVE.L  D2,(A6)+
        MOVEQ   #5,D1
        MOVEQ   #6,D2
        T15     83              get pixel: all of D0
        MOVE.L  D0,(A6)+
        LEA     TABC,A1
        MOVEQ   #10,D1
        MOVEQ   #20,D2
        T15     95              draw text
        MOVE.L  #$03200258,D1   800 x 600
        T15     33
        MOVEQ   #0,D1
        T15     33              get size
        MOVE.L  D1,(A6)+
        LEA     TABC,A1
        MOVE.L  #$FFFFFFFF,D0
        MOVE.B  #70,D0
        TRAP    #15             play sound: result in D0.W only
        MOVE.L  D0,(A6)+
        MOVE.L  #$00000001,D1
        MOVE.L  #$00020003,D2
        MOVEQ   #1,D3
        T15     25              scroll rectangle
        MOVEQ   #24,D0
        MOVEQ   #1,D1
        TRAP    #15             disable simulator key commands
        SIMHALT

        ORG     $2980           case 19: task 0 with a negative length in D1.W
        LEA     TGHIJK,A1
        MOVE.W  #$8000,D1
        T15     1
        SIMHALT

        ORG     $2A00           case 20: unknown task numbers are TRAP exceptions
        MOVE.L  #$00000080,D0   D0.B = $80: negative as a signed byte
        TRAP    #15
        SIMHALT

TABC    DC.B    'ABC',0
TDEF    DC.B    'DEF',0
TGHIJK  DC.B    'GHIJK',0
TNEQ    DC.B    'N=',0
FNAME   DC.B    'OUT.TXT',0

        ORG     $5000
INBUF   DS.B    256

        ORG     $4000
RESULTS DS.B    128

        END     START
