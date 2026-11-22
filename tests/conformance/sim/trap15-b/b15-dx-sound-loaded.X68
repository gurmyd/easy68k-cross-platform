* @item trap15-b 11.4 tasks 73, 74, 75 and 77 (the DirectX player) with a
* @item loaded sound (a 0.2 s PCM WAVE file beside the program): task 74 loads
* @item it into slot 5 (D0.W = 1), task 75 plays slot 5 (1) and empty slot 6
* @item (0), task 77 on slot 5 with commands 0, 1, 2, 4 and 3, and on empty
* @item slot 6 with command 3 (0: the slot must be loaded), task 73 plays the
* @item file (1), task 74 with a file that is no WAVE file (0) and a reload of
* @item slot 5 (1); the high word of D0 is kept throughout
* @files b15-tone.wav b15-not-a-wave.wav
* @owner SH5
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     TONE,A1
    MOVE.L  #$12345605,D1
    MOVE.L  #$ABCD004A,D0       ; task 74: load slot 5
    TRAP    #15
    JSR     DMP_REGS
    MOVEQ   #5,D1
    MOVE.L  #$ABCD004B,D0       ; task 75: play slot 5
    TRAP    #15
    JSR     DMP_REGS
    MOVEQ   #6,D1
    MOVE.L  #$ABCD004B,D0       ; task 75: play empty slot 6
    TRAP    #15
    JSR     DMP_REGS
    LEA     CMDS,A2
CMD:
    MOVE.L  (A2)+,D1            ; slot
    BMI     CMDEND
    MOVE.L  (A2)+,D2            ; command
    MOVE.L  #$ABCD004D,D0       ; task 77
    TRAP    #15
    JSR     DMP_REGS
    BRA     CMD
CMDEND:
    LEA     TONE,A1
    MOVE.L  #$ABCD0049,D0       ; task 73: play the file
    TRAP    #15
    JSR     DMP_REGS
    LEA     NOTWAVE,A1
    MOVEQ   #7,D1
    MOVE.L  #$ABCD004A,D0       ; task 74: no WAVE file into slot 7
    TRAP    #15
    JSR     DMP_REGS
    LEA     TONE,A1
    MOVEQ   #5,D1
    MOVE.L  #$ABCD004A,D0       ; task 74: reload slot 5
    TRAP    #15
    JSR     DMP_REGS
    MOVEQ   #5,D1
    MOVEQ   #3,D2
    MOVE.L  #$ABCD004D,D0       ; task 77: stop all
    TRAP    #15
    JSR     DMP_REGS
    JSR     DMP_CLOSE
    SIMHALT
* slot, command pairs for task 77; a negative slot ends the list
CMDS DC.L   5,0,5,1,5,2,5,4,5,3,6,3,-1
TONE DC.B   'b15-tone.wav',0
NOTWAVE DC.B 'b15-not-a-wave.wav',0
    DS.W    0
    INCLUDE '..\dumplib.X68'
    END     START
