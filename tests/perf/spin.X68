*-----------------------------------------------------------------------------
* spin.X68 - a busy loop that never ends
*
* Part of easy68k-mac (GPL-2.0-or-later). Owner: work package P1
* (docs/ARCHITECTURE.md 6.9 item 9; docs/porting/speed.md).
*
* The fixed program of the processor measurements: at the default speed the
* page must stay nearly idle while it runs (TaskDuration), and at Maximum the
* simulator's instruction count must grow as fast as the engine allows. It
* draws nothing, prints nothing and reads nothing; D0 counts the iterations.
* Stop it with Pause (F6).
*-----------------------------------------------------------------------------

        ORG     $1000
START:  MOVEQ   #0,D0
LOOP:   ADDQ.L  #1,D0
        BRA.S   LOOP

        END     START
