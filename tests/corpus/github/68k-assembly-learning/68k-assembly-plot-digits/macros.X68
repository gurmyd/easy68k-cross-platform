*-----------------------------------------------------------
* Title      : macros
* Written by : Henry Wrightson
* Date       : 18/8/2026
* Type       : Include file
* Depends on : 
* Description: Macros
*-----------------------------------------------------------

;====================================================
;======================= Macros =====================
;====================================================
CacheRegisters macro
    movem.l d0-d7/a0-a6,-(a7)
    endm

RestoreRegisters macro
    movem.l (a7)+,d0-d7/a0-a6
    endm

CacheDataRegisters macro
    movem.l d0-d7,-(a7)
    endm

RestoreDataRegisters macro
    movem.l (a7)+,d0-d7
    endm
