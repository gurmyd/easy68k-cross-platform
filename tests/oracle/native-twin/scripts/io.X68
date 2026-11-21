*-----------------------------------------------------------
* Title      : io
* Written by : easy68k-mac (simulator twin test program)
* Description: TRAP #15 text output, keyboard input, time, delay,
*              the file tasks 50-59 and the file dialog, for
*              io.sim. Part of easy68k-mac, GPL-2.0-or-later.
*-----------------------------------------------------------
        ORG     $1000
START:
        LEA     HELLO,A1
        MOVE.L  #13,D0          display string with CR LF
        TRAP    #15
        MOVE.L  #-12345,D1
        MOVE.L  #3,D0           signed decimal
        TRAP    #15
        MOVE.L  #$1234ABCD,D1
        MOVE.B  #16,D2
        MOVE.L  #15,D0          unsigned in base 16
        TRAP    #15
        LEA     BUFFER,A1
        MOVE.L  #2,D0           read a string
        TRAP    #15
        MOVE.W  D1,LENGTH
        MOVE.L  #4,D0           read a number
        TRAP    #15
        MOVE.L  D1,NUMBER
        MOVE.L  #5,D0           read a character
        TRAP    #15
        MOVE.B  D1,CHAR
        MOVE.L  #8,D0           time
        TRAP    #15
        MOVE.L  D1,TIME
        MOVE.L  #3,D1
        MOVE.L  #23,D0          delay 3/100 s
        TRAP    #15

* files
        MOVE.L  #50,D0          close all
        TRAP    #15
        LEA     INNAME,A1
        MOVE.L  #51,D0          open existing (given by the script)
        TRAP    #15
        MOVE.W  D0,RESULTS
        MOVE.L  D1,D7           file id
        LEA     BUFFER2,A1
        MOVE.L  #100,D2
        MOVE.L  D7,D1
        MOVE.L  #53,D0          read up to 100 bytes (short read)
        TRAP    #15
        MOVE.W  D0,RESULTS+2
        MOVE.L  D2,READCOUNT
        MOVE.L  D7,D1
        MOVE.L  #53,D0          read again: end of file
        TRAP    #15
        MOVE.W  D0,RESULTS+4
        MOVE.L  D7,D1
        MOVE.L  #56,D0          close
        TRAP    #15
        LEA     OUTNAME,A1
        MOVE.L  #52,D0          open new
        TRAP    #15
        MOVE.W  D0,RESULTS+6
        MOVE.L  D1,D7
        LEA     HELLO,A1
        MOVE.L  #12,D2
        MOVE.L  D7,D1
        MOVE.L  #54,D0          write 12 bytes
        TRAP    #15
        MOVE.W  D0,RESULTS+8
        MOVE.L  D7,D1
        MOVE.L  #20,D2
        MOVE.L  #55,D0          position past the end
        TRAP    #15
        LEA     HELLO,A1
        MOVE.L  #4,D2
        MOVE.L  D7,D1
        MOVE.L  #54,D0          write: the file grows with zero bytes
        TRAP    #15
        MOVE.L  D7,D1
        MOVE.L  #56,D0
        TRAP    #15
        LEA     OUTNAME,A1
        MOVE.L  #59,D0          does it exist?
        TRAP    #15
        MOVE.W  D0,RESULTS+10
        LEA     GONENAME,A1
        MOVE.L  #59,D0          a file that does not exist
        TRAP    #15
        MOVE.W  D0,RESULTS+12
        LEA     BADNAME,A1
        MOVE.L  #52,D0          a name the sandbox refuses
        TRAP    #15
        MOVE.W  D0,RESULTS+14
        LEA     INNAME,A1
        MOVE.L  #57,D0          delete the input file
        TRAP    #15
        MOVE.W  D0,RESULTS+16

* file dialog
        MOVE.L  #0,D1
        LEA     TITLE,A1
        LEA     FILTER,A2
        LEA     PATH,A3
        MOVE.L  #58,D0
        TRAP    #15
        MOVE.L  D1,DIALOG
        SIMHALT

HELLO   DC.B    'Hello, twin!',0
INNAME  DC.B    'input.txt',0
OUTNAME DC.B    'Output.BIN',0
GONENAME DC.B   'missing.txt',0
BADNAME DC.B    'C:\no\such.txt',0
TITLE   DC.B    'Pick a file',0
FILTER  DC.B    '*.txt;*.bin',0
        DS.W    0
LENGTH  DS.W    1
NUMBER  DS.L    1
CHAR    DS.B    1
        DS.B    1
TIME    DS.L    1
READCOUNT DS.L  1
DIALOG  DS.L    1
RESULTS DS.W    10
BUFFER  DS.B    82
BUFFER2 DS.B    100
PATH    DS.B    256
        END     START
