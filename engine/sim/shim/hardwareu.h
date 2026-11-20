// easy68k-mac: stand-in for the original hardwareu.h (the "EASy68K Hardware"
// window, class THardware).  The window itself is drawn by the host; all of
// its logic that the 68000 program can observe lives here: interrupt
// requests, the Reset button, the auto-interrupt timers and their master
// flag, hardware enable/disable, the device addresses, the memory map, and
// the memory side effects of switches and push buttons.
// Implemented in shim/hardware.cpp, a port of hardwareu.cpp without the VCL.
#ifndef EASY68K_HARDWAREU_H
#define EASY68K_HARDWAREU_H

#include "vcl.h"
#include "def.h"

// A TTimer whose state changes are reported to the host (host_hw_timer).
class THwTimer {
public:
  THwTimer() : level(0), enabled(false), interval(1000) {}
  int level;
  struct EnabledProp {
    THwTimer *owner;
    operator bool() const { return owner->enabled; }
    EnabledProp &operator=(bool v);
  } Enabled;
  struct IntervalProp {
    THwTimer *owner;
    operator unsigned int() const { return owner->interval; }
    IntervalProp &operator=(unsigned int v);
  } Interval;
  bool enabled;
  unsigned int interval; // milliseconds; the VCL default is 1000
};

class THardware {
public:
  THardware();

  // ---- controls the core files touch -------------------------------------
  // device address boxes (mask "aaaaaa;0;0"), hardwareu.cpp:563-672
  TMaskEdit *seg7addr, *LEDaddr, *switchAddr, *pbAddr;
  // memory map (hardwareu.cpp:1395-1464); set by S0 records in SIMOPS2.CPP
  TCheckBox *ROMChk, *ReadChk, *ProtectedChk, *InvalidChk;
  TMaskEdit *ROMStartEdit, *ROMEndEdit, *ReadStartEdit, *ReadEndEdit;
  TMaskEdit *ProtectedStartEdit, *ProtectedEndEdit, *InvalidStartEdit, *InvalidEndEdit;

  // ---- methods the core files call -----------------------------------------
  void updateIfNeeded(int adr);              // hardwareu.cpp:204
  void autoIRQoff();                         // hardwareu.cpp:796
  void autoIRQon();                          // hardwareu.cpp:811
  void setAutoIRQ(uint irq, uint interval);  // hardwareu.cpp:831
  void disable();                            // hardwareu.cpp:907
  void enable();                             // hardwareu.cpp:923
  void Show();                               // TForm::Show -> FormShow, hardwareu.cpp:195
  void IRQprocess(int irqN);                 // hardwareu.cpp:757

  // ---- the rest of the form's logic (used by shim/api.cpp) ------------------
  bool Visible;
  TCheckBox *CheckBox[8];                    // CheckBox1..CheckBox7 at [1]..[7]
  THwTimer *IRQtimer[8];                     // IRQ1timer..IRQ7timer at [1]..[7]
  bool switchOn[8];                          // switchN->Layout == blGlyphRight
  int AutoIRQItemIndex;                      // AutoIRQ->ItemIndex (combo box), 0 = IRQ 1
  void initialize();                         // hardwareu.cpp:44
  void update();                             // hardwareu.cpp:217
  void FormShow();                           // hardwareu.cpp:195
  void Hide();
  void ResetBtnClick();                      // hardwareu.cpp:778
  void switchClick(int n);                   // switch0Click..switch7Click, hardwareu.cpp:66-192
  void pbDown(int n);                        // pbNMouseDown / pbNKeyDown, hardwareu.cpp:994-1290
  void pbUp(int n);                          // pbNMouseUp / pbNKeyUp
  void switchAddrCommit();                   // switchAddrExit / Enter key, hardwareu.cpp:617-638
  void pbAddrCommit();                       // pbAddrExit / Enter key, hardwareu.cpp:1293-1314
  void checkBoxClick(int n);                 // CheckBoxNClick, hardwareu.cpp:1346-1392
  void IRQintervalSet(unsigned int ms);      // IRQintervalChange, hardwareu.cpp:938
  void AutoIRQChange();                      // hardwareu.cpp:966
  void timerTick(int n);                     // IRQ<n>timer OnTimer -> IRQprocess(n)
};

extern THardware *Hardware;

// globals of hardwareu.cpp:28-34
extern int seg7loc, LEDloc, switchLoc, pbLoc;
extern bool pbInit;
extern bool autoIRQ;
extern bool hardwareEnabled;
extern int ROMStart, ROMEnd, ReadStart, ReadEnd;
extern int ProtectedStart, ProtectedEnd, InvalidStart, InvalidEnd;
extern bool ROMMap, ReadMap, ProtectedMap, InvalidMap;

#endif
