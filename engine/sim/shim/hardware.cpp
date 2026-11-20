// easy68k-mac: hardware.cpp - the logic of the Hardware window (THardware,
// hardwareu.cpp) without the window.
//
// The original keeps part of the machine state in this form's controls and
// event handlers: interrupt requests, the Reset button, the seven
// auto-interrupt timers with their check boxes and master flag, hardware
// enable/disable, the device addresses and the memory map.  All of that is
// ported here, function by function; the comments give the original line.
// Assigning a check box or an edit box runs its handler exactly as the VCL
// does (see BoolProp / TextProp in vcl.h), because the original relies on it
// (initialize(), setAutoIRQ(), the S0 records in loadSrec()).
// docs/porting/hardware.md is the specification this follows.
#include "extern.h"
#include "SIM68Ku.h"
#include "hardwareu.h"
#include "Memory1.h"
#include "Stack1.h"
#include "host.h"
#include "runloop.h"

// hardwareu.cpp:27-34
static AnsiString str1;
int seg7loc, LEDloc, switchLoc, pbLoc;
bool pbInit;
bool autoIRQ;
bool hardwareEnabled;
int ROMStart = 0, ROMEnd = 0, ReadStart = 0, ReadEnd = 0;
int ProtectedStart = 0, ProtectedEnd = 0, InvalidStart = 0, InvalidEnd = 0;
bool ROMMap = false, ReadMap = false, ProtectedMap = false, InvalidMap = false;

static THardware theHardware;
THardware *Hardware = &theHardware;

// The "Auto Interval" edit box (IRQinterval, mask '!99999999;1;0'), as a number.
static unsigned int IRQintervalValue = 1000;

// ---------------------------------------------------------------------------
// timers
// ---------------------------------------------------------------------------
THwTimer::EnabledProp &THwTimer::EnabledProp::operator=(bool v) {
  if (v != owner->enabled) { // TTimer.SetEnabled: no effect if unchanged
    owner->enabled = v;
    host_hw_timer(owner->level, v ? 1 : 0, owner->interval);
  }
  return *this;
}
THwTimer::IntervalProp &THwTimer::IntervalProp::operator=(unsigned int v) {
  if (v != owner->interval) { // TTimer.SetInterval: restarts the timer only on a change
    owner->interval = v;
    host_hw_timer(owner->level, owner->enabled ? 1 : 0, owner->interval);
  }
  return *this;
}

// ---------------------------------------------------------------------------
// event handlers of the controls
// ---------------------------------------------------------------------------
// hardwareu.cpp:563
static void seg7addrChange() {
  str1 = "0x";
  seg7loc = StrToInt(str1 + Hardware->seg7addr->EditText); // get 7-seg address
  Hardware->update();
}
// hardwareu.cpp:573
static void LEDaddrChange() {
  str1 = "0x";
  LEDloc = StrToInt(str1 + Hardware->LEDaddr->EditText); // get LED address
  Hardware->update();
}
// hardwareu.cpp:583
static void switchAddrChange() {
  str1 = "0x";
  switchLoc = StrToInt(str1 + Hardware->switchAddr->EditText); // get switch address
  for (int n = 0; n < 8; n++) Hardware->switchOn[n] = false;  // switchN->Layout = blGlyphLeft
  // (the "switchLoc >= MEMSIZE" branch cannot be reached with six hex digits)
  host_hw_controls();
}
// hardwareu.cpp:642
static void pbAddrChange() {
  str1 = "0x";
  pbLoc = StrToInt(str1 + Hardware->pbAddr->EditText); // get push button address
  if (!((unsigned int)pbLoc >= MEMSIZE)) {
    if (!pbInit) {
      memory[pbLoc] = 0xFF; // init pb data in memory
      MemoryFrm->Repaint();
      StackFrm->Repaint();
      pbInit = true;
    }
  }
}
// hardwareu.cpp:1395-1440
static void ROMStartEditChange() { ROMStart = StrToInt("0x" + Hardware->ROMStartEdit->EditText); }
static void ROMEndEditChange() { ROMEnd = StrToInt("0x" + Hardware->ROMEndEdit->EditText); }
static void ReadStartEditChange() { ReadStart = StrToInt("0x" + Hardware->ReadStartEdit->EditText); }
static void ReadEndEditChange() { ReadEnd = StrToInt("0x" + Hardware->ReadEndEdit->EditText); }
static void ProtectedStartEditChange() { ProtectedStart = StrToInt("0x" + Hardware->ProtectedStartEdit->EditText); }
static void ProtectedEndEditChange() { ProtectedEnd = StrToInt("0x" + Hardware->ProtectedEndEdit->EditText); }
static void InvalidStartEditChange() { InvalidStart = StrToInt("0x" + Hardware->InvalidStartEdit->EditText); }
static void InvalidEndEditChange() { InvalidEnd = StrToInt("0x" + Hardware->InvalidEndEdit->EditText); }
// hardwareu.cpp:1443-1464
static void ROMChkClick() { ROMMap = Hardware->ROMChk->Checked; host_hw_controls(); }
static void ReadChkClick() { ReadMap = Hardware->ReadChk->Checked; host_hw_controls(); }
static void ProtectedChkClick() { ProtectedMap = Hardware->ProtectedChk->Checked; host_hw_controls(); }
static void InvalidChkClick() { InvalidMap = Hardware->InvalidChk->Checked; host_hw_controls(); }
// hardwareu.cpp:1346-1392  CheckBox1Click .. CheckBox7Click
static void CheckBox1Click() { Hardware->checkBoxClick(1); }
static void CheckBox2Click() { Hardware->checkBoxClick(2); }
static void CheckBox3Click() { Hardware->checkBoxClick(3); }
static void CheckBox4Click() { Hardware->checkBoxClick(4); }
static void CheckBox5Click() { Hardware->checkBoxClick(5); }
static void CheckBox6Click() { Hardware->checkBoxClick(6); }
static void CheckBox7Click() { Hardware->checkBoxClick(7); }

void THardware::checkBoxClick(int n) {
  if (autoIRQ) IRQtimer[n]->Enabled = CheckBox[n]->Checked;
  host_hw_controls();
}

static TMaskEdit *newAddressBox(TNotify onChange) {
  TMaskEdit *box = new TMaskEdit(); // EditMask = 'aaaaaa;0;0'
  box->Text.maskKind = 'a';
  box->Text.maskLength = 6;
  box->Text.init("000000");
  box->Text.changed = onChange;
  return box;
}
static TCheckBox *newCheckBox(TNotify onClick) {
  TCheckBox *box = new TCheckBox();
  box->Checked.changed = onClick;
  return box;
}

THardware::THardware() {
  seg7addr = newAddressBox(seg7addrChange);
  LEDaddr = newAddressBox(LEDaddrChange);
  switchAddr = newAddressBox(switchAddrChange);
  pbAddr = newAddressBox(pbAddrChange);
  ROMChk = newCheckBox(ROMChkClick);
  ReadChk = newCheckBox(ReadChkClick);
  ProtectedChk = newCheckBox(ProtectedChkClick);
  InvalidChk = newCheckBox(InvalidChkClick);
  ROMStartEdit = newAddressBox(ROMStartEditChange);
  ROMEndEdit = newAddressBox(ROMEndEditChange);
  ReadStartEdit = newAddressBox(ReadStartEditChange);
  ReadEndEdit = newAddressBox(ReadEndEditChange);
  ProtectedStartEdit = newAddressBox(ProtectedStartEditChange);
  ProtectedEndEdit = newAddressBox(ProtectedEndEditChange);
  InvalidStartEdit = newAddressBox(InvalidStartEditChange);
  InvalidEndEdit = newAddressBox(InvalidEndEditChange);
  TNotify clicks[8] = {0, CheckBox1Click, CheckBox2Click, CheckBox3Click, CheckBox4Click,
                       CheckBox5Click, CheckBox6Click, CheckBox7Click};
  CheckBox[0] = 0;
  IRQtimer[0] = 0;
  for (int n = 1; n <= 7; n++) {
    CheckBox[n] = newCheckBox(clicks[n]);
    IRQtimer[n] = new THwTimer();
    IRQtimer[n]->level = n;
    IRQtimer[n]->Enabled.owner = IRQtimer[n];
    IRQtimer[n]->Interval.owner = IRQtimer[n];
  }
  for (int n = 0; n < 8; n++) switchOn[n] = false;
  Visible = false;
  AutoIRQItemIndex = 0;
  // FormCreate, hardwareu.cpp:1318
  pbInit = false;         // push buttons not initialized
  autoIRQ = false;        // automatic IRQ disabled
  hardwareEnabled = true;
}

// ---------------------------------------------------------------------------
// Return hardware to new positions                        (hardwareu.cpp:44)
// ---------------------------------------------------------------------------
void THardware::initialize() {
  for (int n = 0; n < 8; n++) switchOn[n] = false; // switchN->Layout = blGlyphLeft
  for (int n = 1; n <= 7; n++) CheckBox[n]->Checked = false;
  autoIRQoff();
  update();
}

// hardwareu.cpp:66-192  switch0Click .. switch7Click
void THardware::switchClick(int n) {
  if (!switchOn[n]) {
    // switch on
    switchOn[n] = true;
    memory[switchLoc] |= (char)(1 << n);
  } else {
    // switch off
    switchOn[n] = false;
    memory[switchLoc] &= (char)~(1 << n);
  }
  update();
  MemoryFrm->Repaint();
  StackFrm->Repaint();
}

// hardwareu.cpp:994-1290  pbNMouseDown / pbNKeyDown, pbNMouseUp / pbNKeyUp
void THardware::pbDown(int n) {
  memory[pbLoc] &= (char)~(1 << n);
  update();
  MemoryFrm->Repaint();
  StackFrm->Repaint();
}
void THardware::pbUp(int n) {
  memory[pbLoc] |= (char)(1 << n);
  update();
  MemoryFrm->Repaint();
  StackFrm->Repaint();
}

// hardwareu.cpp:195
void THardware::FormShow() {
  update();
  memory[switchLoc] = 0x00;
  MemoryFrm->Repaint();
  StackFrm->Repaint();
}

// TForm::Show(): OnShow fires only when the form was hidden.
void THardware::Show() {
  if (!Visible) {
    Visible = true;
    FormShow();
  }
  host_hw_show();
}
void THardware::Hide() { Visible = false; }

// hardwareu.cpp:204
void THardware::updateIfNeeded(int adr) {
  if ((unsigned int)adr < MEMSIZE) {                  // if in valid memory space
    if ((adr >= seg7loc - 4 && adr <= seg7loc + 15) || // if address in seg7 display
        (adr >= LEDloc - 4 && adr <= LEDloc)) {        // if address of LEDs
      update();
    }
  }
}

// update displays (hardwareu.cpp:217).  The original recolours the shapes from
// memory here; the host does that when it is told.
void THardware::update() {
  if (Hardware->Visible) host_hw_update();
}

// hardwareu.cpp:617-638  switchAddrExit, switchAddrKeyDown (Enter)
void THardware::switchAddrCommit() {
  str1 = "0x";
  switchLoc = StrToInt(str1 + switchAddr->EditText); // get switch address
  memory[switchLoc] = 0x00;                          // set switch memory to 0
  MemoryFrm->Repaint();
  StackFrm->Repaint();
}

// hardwareu.cpp:1293-1314  pbAddrKeyDown (Enter), pbAddrExit
void THardware::pbAddrCommit() {
  if ((unsigned int)pbLoc < MEMSIZE) { // if valid address
    memory[pbLoc] = 0xFF;
    update();
    MemoryFrm->Repaint();
    StackFrm->Repaint();
  }
}

// ---------------------------------------------------------------------------
// interrupts
// ---------------------------------------------------------------------------
// hardwareu.cpp:757
void THardware::IRQprocess(int irqN) {
  static int intMask;
  if (hardwareEnabled) {
    if (irqN > 0) // Reset calls IRQprocess with irqN = 0
      irq |= (0x01 << (irqN - 1));
    if (stopInstruction) { // if CPU halted after STOP instruction
      intMask = 0xFF80 >> (7 - ((SR & intmsk) >> 8)) | 0x40;
      if (!(irq & intMask)) // if IRQ masked
        return;
    }
    inc_cyc(44); // Interrupt execution time
    if (!trace)
      runMode = true; // enable runLoop() if not tracing ck 1-11-2008
    // if (runMode) Form1->runLoop();   -> the host calls sim_run() when runMode is true
  }
}

// IRQ<n>timer OnTimer = IRQ<n> -> IRQprocess(n), hardwareu.cpp:715-755.  A
// tick only comes from a timer that is enabled.
void THardware::timerTick(int n) {
  if (IRQtimer[n]->enabled) IRQprocess(n);
}

// hardwareu.cpp:778
void THardware::ResetBtnClick() {
  if (hardwareEnabled) {
    hardReset = true;
    SR = SR | sbit;                   // supervisor
    SR = SR & ~tbit;                  // trace off
    SR = SR | 0x700;                  // mask = 7
    mem_req(0x00, LONG_MASK, &A[8]);  // SSP from vector 0
    mem_req(0x04, LONG_MASK, &PC);    // PC from vector 1
    inc_cyc(40);
    stopInstruction = false;
    scrshow();
    IRQprocess(0);
  }
}

// hardwareu.cpp:796
void THardware::autoIRQoff() {
  for (int n = 1; n <= 7; n++) IRQtimer[n]->Enabled = false;
  autoIRQ = false; // AutoLbl->Caption = "Automatic Disabled"
  host_hw_state(hardwareEnabled ? 1 : 0, 0);
}

// hardwareu.cpp:811
void THardware::autoIRQon() {
  for (int n = 1; n <= 7; n++) IRQtimer[n]->Enabled = (bool)CheckBox[n]->Checked;
  autoIRQ = true; // AutoLbl->Caption = "Automatic Enabled"
  host_hw_state(hardwareEnabled ? 1 : 0, 1);
}

// The masked edit '!99999999;1;0' holds at most eight digits.  A larger number
// assigned to it is assumed to keep its first eight digits (hardware.md U1:
// not verifiable from the source).
static unsigned int eightDigits(unsigned int value) {
  while (value > 99999999u) value /= 10u;
  return value;
}

// hardwareu.cpp:938  IRQintervalChange: the text of the interval box changed
void THardware::IRQintervalSet(unsigned int ms) {
  ms = eightDigits(ms);
  if (ms == IRQintervalValue) return; // no OnChange without a change
  IRQintervalValue = ms;
  if (AutoIRQItemIndex >= 0 && AutoIRQItemIndex <= 6) IRQtimer[AutoIRQItemIndex + 1]->Interval = IRQintervalValue;
  host_hw_controls();
}

// hardwareu.cpp:966  the level shown in the combo box changed (or was re-read)
void THardware::AutoIRQChange() {
  if (AutoIRQItemIndex >= 0 && AutoIRQItemIndex <= 6)
    IRQintervalSet(IRQtimer[AutoIRQItemIndex + 1]->interval); // IRQinterval->Text = IRQntimer->Interval
}

// Pre: irq  = 00 to disable all auto IRQs
//        or   Bit 7 = 0 to disable an auto IRQ
//             Bit 7 = 1 to enable an auto IRQ
//             Bits 6-0 = IRQ number 1 through 7
//  interval = Auto Interval in mS, 1 through 99999999     (hardwareu.cpp:831)
void THardware::setAutoIRQ(uint irq, uint interval) {
  if (irq == 0x00) { // disable all auto IRQs
    autoIRQoff();
    for (int n = 1; n <= 7; n++) CheckBox[n]->Checked = false;
  } else if (irq >= 0x01 && irq <= 0x07) { // disable auto IRQ n
    CheckBox[irq]->Checked = false;
    IRQtimer[irq]->Enabled = false;
  } else if (irq >= 0x81 && irq <= 0x87) { // enable auto IRQ n
    IRQtimer[irq - 0x80]->Interval = interval;
    CheckBox[irq - 0x80]->Checked = true;
  }
  AutoIRQChange(); // display current values
}

// hardwareu.cpp:907
void THardware::disable() {
  autoIRQoff();
  hardwareEnabled = false;
  host_hw_state(0, autoIRQ ? 1 : 0); // Reset and IRQ buttons disabled
}

// hardwareu.cpp:923
void THardware::enable() {
  autoIRQon();
  hardwareEnabled = true;
  host_hw_state(1, autoIRQ ? 1 : 0); // Reset and IRQ buttons enabled
}

unsigned int easy68k_hw_interval_box() { return IRQintervalValue; }
