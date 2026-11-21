# For W3 at the next gate: two small follow-ups on settings shared by several windows

Status: open. Found by the independent review of the repair of settings lost between two windows
(commits 1e086f7 and 46dfe79; errata `docs/porting/errata/W3.md`, entries 26 and 27).

1. **A change made after an outside document arrived can be undone by a window that hears of that
   document later.** A settings document without stamps (written by developer tools, another tool,
   or a version of the port from before stamps) is stamped by each window with the time at which
   that window receives it. A window that receives it late therefore holds a later stamp than a
   real change a person made meanwhile in a window that already had it, and its write-back restores
   the outside value. Reviewer's case: outside document sets the font size to 21 at 2000; window B
   receives it at 2010; the person sets 30 in B at 2020; window A receives the outside document at
   2030 and then B's write; every window and the store end with 21, where 30 is right.
   Repair: give an outside document the same stamp in every window, or one that is never later
   than changes made after it (for example, the first window that takes it in writes it back at
   once with its stamps, and a window that later receives the same text without stamps does not
   stamp it newer than the stamped documents it already knows).

2. **Errata entry 26 keeps two sentences that entry 27 made untrue** (the shell check "wants two"
   out-of-date reads; the window "writes the merged document back at once"), and the proposed texts
   for 3.8.6 rule 2 and 3.10 do not mention documents without stamps or the delayed write-back.
   Repair: mark the two sentences as superseded or edit them, and add one sentence to the proposed
   texts.

Not covered by any test in a browser: a window closed by a crash inside the 10 to 50 ms pause
before its write-back, and the reduction in write-backs with four windows (unit test only).
