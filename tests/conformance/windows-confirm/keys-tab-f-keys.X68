*-----------------------------------------------------------------------------
* keys-tab-f-keys.X68 - keys that the VCL may take before the program sees
* them (trap15-a 12 item 13; trap15-b 15 V10). Interactive: run it on real
* Windows (SIM68K.exe keys-tab-f-keys.S68 /r), click into the Output window
* and follow the prompts. Each step polls task 19 for about three seconds and
* records whether the key was ever seen down ($FF) in result.bin:
*   1. hold Tab        2. hold F6 (key commands on: expect a pause - press F9)
*   3. hold F9         then task 24 turns the key commands off and
*   4. hold F6 again   5. hold F9 again   6. press Tab, then Enter (task 5)
*-----------------------------------------------------------------------------
    ORG     $1000
START:
    JSR     DMP_OPEN
    LEA     STEPS,A3
    MOVEQ   #0,D7
SLOOP:
    MOVE.L  (A3)+,D6            ; key code
    BEQ     SDONE
    MOVEA.L (A3)+,A1            ; prompt
    MOVEQ   #13,D0
    TRAP    #15
    CMP.L   #4,D7
    BNE     NOT24
    MOVEQ   #1,D1
    MOVEQ   #24,D0
    TRAP    #15                 ; key commands off before step 4
NOT24:
    MOVEQ   #0,D5               ; seen
    MOVE.W  #300,D4             ; 300 polls, 10 ms apart
POLL:
    MOVE.L  D6,D1
    MOVEQ   #19,D0
    TRAP    #15
    OR.B    D1,D5
    MOVEQ   #1,D1
    MOVEQ   #23,D0
    TRAP    #15
    DBRA    D4,POLL
    MOVE.L  D5,D1
    LEA     SEEN,A1
    JSR     DMP_VAL
    ADDQ.L  #1,D7
    BRA     SLOOP
SDONE:
    LEA     P6,A1
    MOVEQ   #13,D0
    TRAP    #15
    MOVEQ   #5,D0
    TRAP    #15                 ; Tab, then Enter: which character arrives?
    LEA     CHAR,A1
    JSR     DMP_VAL
    MOVEQ   #0,D1
    MOVEQ   #24,D0
    TRAP    #15
    JSR     DMP_CLOSE
    SIMHALT
STEPS DC.L  $09,P1,$75,P2,$78,P3,$75,P4,$78,P5,0
P1    DC.B  '1. Hold Tab for three seconds',0
P2    DC.B  '2. Hold F6 (if the simulator pauses, press F9)',0
P3    DC.B  '3. Hold F9 for three seconds',0
P4    DC.B  '4. (key commands are now off) Hold F6',0
P5    DC.B  '5. Hold F9',0
P6    DC.B  '6. Press Tab, then Enter',0
SEEN  DC.B  'seen',0
CHAR  DC.B  'task5',0
    DS.W    0
    INCLUDE '..\sim\dumplib.X68'
    END     START