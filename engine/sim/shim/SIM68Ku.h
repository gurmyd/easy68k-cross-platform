// easy68k-mac: stand-in for the original SIM68Ku.h (the main window of the
// simulator, class TForm1).  It has the members the core files use, with the
// original names, plus the engine-side parts of the main form: program
// loading, the run commands, register display and editing, and the lookup of
// a listing line for the execution log.  Implemented in shim/form1.cpp.
#ifndef EASY68K_SIM68KU_H
#define EASY68K_SIM68KU_H

#include "vcl.h"

class TMemo {
public:
  TMemo();
  TStrings *Lines; // the message area
  TFont *Font;
};

class TListBox {
public:
  TListBox();
  TStrings *Items; // the lines of the .L68 listing
  int ItemIndex;   // highlighted line, -1 = none
  TFont *Font;
  void Clear();
  void Repaint();
  // ListBox1->Count
  struct CountProp {
    explicit CountProp(TListBox &o) : owner(o) {}
    operator int() const { return owner.Items->Count; }
    TListBox &owner;
  } Count;
};

class TTimer {
public:
  BoolProp Enabled;
};

class TMonitor {
public:
  TMonitor() : MonitorNum(0) {}
  int MonitorNum; // number of the monitor the main window is on
};

class TForm1 {
public:
  TForm1();

  // ---- members used by RUN.CPP, UTILS.CPP, STARTSIM.CPP, SIMOPS2.CPP, CODE9.CPP
  TMemo *Message;
  TTimer *AutoTraceTimer;
  TMaskEdit *regD0, *regD1, *regD2, *regD3, *regD4, *regD5, *regD6, *regD7;
  TMaskEdit *regA0, *regA1, *regA2, *regA3, *regA4, *regA5, *regA6, *regA7;
  TMaskEdit *regUS, *regA8, *regPC, *regSR;
  TLabel *cyclesDisplay;
  TListBox *ListBox1;
  TLabel *HeadingsLbl;
  TFontDialog *FontDialogSimIO, *FontDialogSource, *FontDialogPrinter;
  TMenuItem *ExceptionsEnabled, *BitFieldEnabled;
  TMonitor *Monitor;

  void setMenuActive();     // SIM68Ku.cpp:560
  void setMenuTrace();      // SIM68Ku.cpp:608
  void setMenuTask19();     // SIM68Ku.cpp:619
  void restoreMenuTask19(); // SIM68Ku.cpp:636
  void SetFocus();
  void SaveSettings();
  bool lineToLog();         // SIM68Ku.cpp:869
  void highlight();         // SIM68Ku.cpp:785

  // ---- the rest of the main form's execution logic (used by shim/api.cpp)
  int startPC;              // SIM68Ku.h:276
  int menuState;            // MENU_ACTIVE / MENU_TRACE as last set
  bool isInstruction(const AnsiString &str); // SIM68Ku.cpp:856
  void loadRegs();          // SIM68Ku.cpp:990
  void defaultSettings();   // SIM68Ku.cpp:1488 (the core variables only)
  void OpenFile(const AnsiString &name, bool listingExists); // SIM68Ku.cpp:270
  void RunExecute();        // SIM68Ku.cpp:441 without runLoop()
  void RunToCursorExecute(int itemIndex); // SIM68Ku.cpp:468
  void StepExecute();       // SIM68Ku.cpp:501 without runLoop()
  void PauseExecute();      // SIM68Ku.cpp:525
  void RewindExecute();     // SIM68Ku.cpp:542
  void CloseExecute();      // SIM68Ku.cpp:426, after the confirmation box
  void ClearCyclesClick();  // SIM68Ku.cpp:1256
  // typing in a register box: change / key-up handlers, SIM68Ku.cpp:1043-1194
  void regSRChange();
  void regPCChange();
  void regAKeyUp(int n);    // regA0KeyUp .. regA6KeyUp
  void regA7KeyUp();
  void regUSKeyUp();
  void regA8KeyUp();
  TMaskEdit *regBox(int which); // by SIM_BOX_* number (api.h)
};

extern TForm1 *Form1;
extern bool disableKeyCommands; // SIM68Ku.cpp:32

// Called at the end of scrshow() (marked change in STARTSIM.CPP): the register
// boxes, cycle display and listing highlight are up to date.
void easy68k_scrshow_done();

#endif
