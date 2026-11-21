* @item sim-ui 19 Q23: listing rows are used as printf format strings in the
* @item execution log (a comment with %d, %s and %% on instruction lines)
* @recipe log:2
    ORG     $1000
START:
    MOVEQ   #5,D0               ; 100% sure: %d %x %%
    MOVEQ   #6,D1               ; percent sign at the end %
    ADD.L   D0,D1               ; %c%c%c
    MOVEQ   #7,D2               ; no conversion here
    SIMHALT
    END     START