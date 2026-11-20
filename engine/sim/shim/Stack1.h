// easy68k-mac: stand-in for the original Stack1.h (the Stack window, class
// TStackFrm).  The core only asks it to repaint (shim/misc.cpp).
#ifndef EASY68K_STACK1_H
#define EASY68K_STACK1_H

class TStackFrm {
public:
  void updateDisplay();
  void Repaint();
};

extern TStackFrm *StackFrm;

#endif
