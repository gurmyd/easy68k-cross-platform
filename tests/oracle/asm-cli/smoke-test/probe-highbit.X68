* High-bit probe: bytes >= $80 (Windows-1252) in comments, strings and DC.B
* cafι naοve © € ÿ
        ORG     $1000
START   LEA     TEXT,A1         comment with ιθό
        MOVE.B  #'ι',D0
        CMP.B   #'ÿ',D1
        SIMHALT
TEXT    DC.B    'cafι όber €ÿ',0
WIDE    DC.W    'ιθ'
LONG    DC.L    'ιθόÿ'
        END     START
