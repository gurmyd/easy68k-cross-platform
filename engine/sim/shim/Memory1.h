// easy68k-mac: stand-in for the original Memory1.h (the Memory window, class
// TMemoryFrm).  The core only asks it to repaint; both calls become host
// notifications (shim/misc.cpp).
#ifndef EASY68K_MEMORY1_H
#define EASY68K_MEMORY1_H

class TMemoryFrm {
public:
  void LivePaint(unsigned int loc); // Memory1.cpp:129, after every successful mem_put
  void Repaint();
};

extern TMemoryFrm *MemoryFrm;

#endif
