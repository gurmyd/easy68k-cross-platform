// easy68k-mac: stand-in for the original BREAKPOINTSu.h (the Breakpoints
// window, class TBreaksFrm).  The editor is a host matter; the engine keeps
// the three functions that change what runprog() tests.
// Implemented in shim/misc.cpp.
#ifndef EASY68K_BREAKPOINTSU_H
#define EASY68K_BREAKPOINTSU_H

class TBreaksFrm {
public:
  int sbpoint(int loc); // BREAKPOINTSu.cpp:112  set a PC breakpoint
  int cbpoint(int loc); // BREAKPOINTSu.cpp:132  clear one (-1: all)
  void resetDebug();    // BREAKPOINTSu.cpp:161  zero the hit counters
  void Repaint();
};

extern TBreaksFrm *BreaksFrm;

#endif
