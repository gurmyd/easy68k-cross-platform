// easy68k-mac: form1.cpp - the engine side of the simulator's main window.
//
// This is a port of the parts of SIM68Ku.cpp (class TForm1) that decide what
// the 68000 program or the execution log can observe: loading a program and
// its listing, the run commands, the register text boxes, the listing
// highlight and the execution-log line lookup.  Each function names the
// original it was taken from; statements are kept in the original order.
// Everything visual is a notification to the host (shim/host.h).
#include "extern.h"
#include "SIM68Ku.h"
#include "simIOu.h"
#include "hardwareu.h"
#include "logU.h"
#include "Memory1.h"
#include "Stack1.h"
#include "Optionsu.h"
#include "BREAKPOINTSu.h"
#include "host.h"
#include "runloop.h"
#include "api.h"

extern AnsiString errstr; // var.h

static TForm1 theForm1;
TForm1 *Form1 = &theForm1;
bool disableKeyCommands = false; // SIM68Ku.cpp:32

// The bytes of the .L68 file of the program being loaded (NULL if there is
// none), staged by sim_open_file().
const unsigned char *easy68k_listing_data = NULL;
int easy68k_listing_length = 0;

// ---------------------------------------------------------------------------
// components
// ---------------------------------------------------------------------------
static void messageAdded(const AnsiString &line) { host_message(line.c_str(), line.Length()); }
static void messagesCleared() { host_messages_clear(); }

TMemo::TMemo() : Lines(new TStrings()), Font(new TFont(FONT_TARGET_MESSAGES)) {
  // The message area is shown by the host; the engine does not keep the lines.
  Lines->keep = false;
  Lines->added = messageAdded;
  Lines->cleared = messagesCleared;
}

TListBox::TListBox() : Items(new TStrings()), ItemIndex(-1), Font(new TFont(FONT_TARGET_LISTING)), Count(*this) {}
void TListBox::Clear() {
  Items->Clear();
  ItemIndex = -1;
}
void TListBox::Repaint() { host_repaint(REPAINT_LISTING); }

static void regSRChanged() { Form1->regSRChange(); }
static void regPCChanged() { Form1->regPCChange(); }
static void autoTraceTimerChanged() { host_autotrace_timer(Form1->AutoTraceTimer->Enabled ? 1 : 0); }
static void exceptionsChecked() { host_option_changed(OPTION_EXCEPTIONS, Form1->ExceptionsEnabled->Checked ? 1 : 0); }
static void bitFieldChecked() { host_option_changed(OPTION_BITFIELD, Form1->BitFieldEnabled->Checked ? 1 : 0); }

static TMaskEdit *newRegisterBox(char maskKind, int maskLength, const char *text) {
  TMaskEdit *box = new TMaskEdit();
  box->Text.maskKind = maskKind;
  box->Text.maskLength = maskLength;
  box->Text.init(text);
  return box;
}

TForm1::TForm1() {
  Message = new TMemo();
  AutoTraceTimer = new TTimer();
  AutoTraceTimer->Enabled.changed = autoTraceTimerChanged;
  // SIM68Ku.dfm: EditMask 'aaaaaaaa;0;0' for the 19 hexadecimal boxes,
  // '9999999999999999;0;0' for the status register.
  TMaskEdit **hexBoxes[] = {&regD0, &regD1, &regD2, &regD3, &regD4, &regD5, &regD6, &regD7,
                            &regA0, &regA1, &regA2, &regA3, &regA4, &regA5, &regA6, &regA7,
                            &regUS, &regA8, &regPC};
  for (unsigned i = 0; i < sizeof(hexBoxes) / sizeof(hexBoxes[0]); i++)
    *hexBoxes[i] = newRegisterBox('a', 8, "00000000");
  regSR = newRegisterBox('9', 16, "0000000000000000");
  regSR->Text.changed = regSRChanged; // OnChange = regSRChange
  regPC->Text.changed = regPCChanged; // OnChange = regPCChange
  cyclesDisplay = new TLabel();
  ListBox1 = new TListBox();
  HeadingsLbl = new TLabel();
  HeadingsLbl->Font->id = FONT_TARGET_HEADINGS;
  FontDialogSimIO = new TFontDialog(FONT_SOURCE_IO_DIALOG);
  FontDialogSource = new TFontDialog(FONT_SOURCE_LISTING_DIALOG);
  FontDialogPrinter = new TFontDialog(FONT_SOURCE_PRINTER_DIALOG);
  ExceptionsEnabled = new TMenuItem();
  ExceptionsEnabled->Checked.changed = exceptionsChecked;
  BitFieldEnabled = new TMenuItem();
  BitFieldEnabled->Checked.changed = bitFieldChecked;
  Monitor = new TMonitor();
  startPC = 0;
  menuState = MENU_ACTIVE;
}

TMaskEdit *TForm1::regBox(int which) {
  TMaskEdit *boxes[] = {regD0, regD1, regD2, regD3, regD4, regD5, regD6, regD7,
                        regA0, regA1, regA2, regA3, regA4, regA5, regA6, regA7,
                        regUS, regA8, regPC, regSR};
  if (which < 0 || which >= (int)(sizeof(boxes) / sizeof(boxes[0]))) return NULL;
  return boxes[which];
}

// ---------------------------------------------------------------------------
// menu state, focus, settings
// ---------------------------------------------------------------------------
// SIM68Ku.cpp:560.  Enables Open, Close, Run, Run To Cursor, Auto Trace, Step
// Over, Trace Into, Pause, Rewind.
void TForm1::setMenuActive() {
  if (AutoTraceTimer->Enabled) return;
  menuState = MENU_ACTIVE;
  host_menu_state(MENU_ACTIVE);
}

// SIM68Ku.cpp:608.  Disables the commands above except Pause, Rewind and Close.
void TForm1::setMenuTrace() {
  menuState = MENU_TRACE;
  host_menu_state(MENU_TRACE);
}

// SIM68Ku.cpp:619
void TForm1::setMenuTask19() {
  disableKeyCommands = true;
  host_key_commands(0);
}

// SIM68Ku.cpp:636
void TForm1::restoreMenuTask19() {
  disableKeyCommands = false;
  host_key_commands(1);
}

void TForm1::SetFocus() { host_focus_main(); }
void TForm1::SaveSettings() { host_save_settings(); }

// Called at the end of scrshow() (STARTSIM.CPP).
void easy68k_scrshow_done() { host_show_regs(); }

// SIM68Ku.cpp:1488-1497 (core variables) and 1518-1521 (hardware addresses).
void TForm1::defaultSettings() {
  ElogFlag = 0; // disable logging on startup
  OlogFlag = 0;
  logging = false;
  exceptions = false; // default to exceptions off
  bitfield = false;   // default to bitfield instruction off
  simhalt_on = true;  // default to SIMHALT enabled
  Hardware->seg7addr->Text = "E00000";
  Hardware->LEDaddr->Text = "E00010";
  Hardware->switchAddr->Text = "E00012";
  Hardware->pbAddr->Text = "E00014";
}

// ---------------------------------------------------------------------------
// listing
// ---------------------------------------------------------------------------
// check to see if str contains a machine code instruction
// pre: str contains a line of code from the L68 file
// post: returns true if instruction, false if not          (SIM68Ku.cpp:856)
bool TForm1::isInstruction(const AnsiString &str) {
  if (str.SubString(1, 2) == "00" && // address
      str[11] != ' ' &&              // data present
      str[9] != '=' &&               // not DS or DC
      str[11] != '=')                // not EQU or SET
    return true;
  return false;
}

// highlight the instruction                                  (SIM68Ku.cpp:785)
void TForm1::highlight() {
  int i;
  AnsiString str;

  for (i = 3; i < ListBox1->Items->Count; i++) {
    str = ListBox1->Items->Strings[i];
    if (regPC->EditText == str.UpperCase().SubString(1, 8)) // if current instruction
      if (isInstruction(str) || halt)                      // if instruction or program halted
        ListBox1->ItemIndex = i;                           // highlight line
  }
  // (scrolling the highlighted line into view is done by the host)
}

// TStrings::LoadFromFile: split the file into lines at CR, LF or CR LF; a NUL
// byte ends the text (Delphi TStrings.SetTextStr).
static void loadListing(TStrings *items, const unsigned char *data, int length) {
  int p = 0;
  while (p < length && data[p] != 0) {
    int start = p;
    while (p < length && data[p] != 0 && data[p] != 10 && data[p] != 13) p++;
    items->Add(AnsiString((const char *)data + start, (size_t)(p - start)));
    if (p < length && data[p] == 13) p++;
    if (p < length && data[p] == 10) p++;
  }
}

// write the current instruction line to the log file
// returns true on success                                    (SIM68Ku.cpp:869)
bool TForm1::lineToLog() {
  int topIndex, botIndex, midIndex;
  AnsiString str;
  bool foundPC = false;
  const int TOP_INDEX = 3;

  // index of bottom row
  botIndex = ListBox1->Count;
  if (botIndex > TOP_INDEX) {
    topIndex = TOP_INDEX;

    // do binary search for the current PC in the Listing
    do {
      midIndex = (botIndex - topIndex) / 2 + topIndex;
      str = ListBox1->Items->Strings[midIndex];
      if (regPC->EditText == str.SubString(1, 8)) // if PC == Listing PC
        foundPC = true;
      else if (regPC->EditText < str.SubString(1, 8)) // if PC < Listing PC
        botIndex = midIndex - 1;
      else // else PC > Listing PC
        topIndex = midIndex + 1;
    } while (!foundPC && topIndex <= botIndex);

    if (foundPC) {
      do { // skip comments and go to last row with this PC
        midIndex++;
        str = ListBox1->Items->Strings[midIndex];
      } while (regPC->EditText == str.SubString(1, 8));
      midIndex--;
      str = ListBox1->Items->Strings[midIndex];
      str.Insert("PC=", 0);    // add labels
      str.Insert("Code=", 14); // add labels
      str.Insert("Line=", 42); // add labels
      // The original is fprintf(ElogFile, str.c_str()): the listing line is
      // used as the FORMAT string, so a '%' in the source line makes printf
      // read arguments that do not exist.  What that printed depended on the
      // stack contents.  The line is written literally here (PATCHES.md).
      fputs(str.c_str(), ElogFile); // output instruction to log file
      fprintf(ElogFile, "\n");
      fflush(ElogFile); // write all bufferred data to file
    }
  }
  return foundPC;
}

// ---------------------------------------------------------------------------
// register boxes
// ---------------------------------------------------------------------------
// Load registers from screen                                 (SIM68Ku.cpp:990)
void TForm1::loadRegs() {
  AnsiString str = "0x";

  // load each bit of SR
  SR = 0;
  for (int j = 15; j >= 0; j--) {
    if (regSR->EditText[16 - j] == '1') SR = SR | 1 << j;
  }

  D[0] = StrToInt(str + regD0->EditText);
  D[1] = StrToInt(str + regD1->EditText);
  D[2] = StrToInt(str + regD2->EditText);
  D[3] = StrToInt(str + regD3->EditText);
  D[4] = StrToInt(str + regD4->EditText);
  D[5] = StrToInt(str + regD5->EditText);
  D[6] = StrToInt(str + regD6->EditText);
  D[7] = StrToInt(str + regD7->EditText);
  A[0] = StrToInt(str + regA0->EditText);
  A[1] = StrToInt(str + regA1->EditText);
  A[2] = StrToInt(str + regA2->EditText);
  A[3] = StrToInt(str + regA3->EditText);
  A[4] = StrToInt(str + regA4->EditText);
  A[5] = StrToInt(str + regA5->EditText);
  A[6] = StrToInt(str + regA6->EditText);
  A[a_reg(7)] = StrToInt(str + regA7->EditText);
  A[8] = StrToInt(str + regA8->EditText);
  PC = OLD_PC = StrToInt(str + regPC->EditText);
}

// SIM68Ku.cpp:1043
void TForm1::regSRChange() {
  String str;
  if (regSR->EditText[3] == '1') // if Supervisor mode
    regA7->Text = str.sprintf("%08lX", A[8]);
  else
    regA7->Text = str.sprintf("%08lX", A[7]);

  StackFrm->updateDisplay();
}

// SIM68Ku.cpp:1186
void TForm1::regPCChange() {
  // If NOT (auto trace AND display is disabled)
  if (!(autoTraceInProgress && AutoTraceOptions->DisableDisplay->Checked)) {
    StackFrm->updateDisplay();
    highlight(); // highlight code at PC
  }
}

// regA0KeyUp .. regA6KeyUp, SIM68Ku.cpp:1093-1147
void TForm1::regAKeyUp(int n) {
  AnsiString str = "0x";
  A[n] = StrToInt(str + regBox(SIM_BOX_A0 + n)->EditText);
  StackFrm->updateDisplay();
}

// SIM68Ku.cpp:1150
void TForm1::regA7KeyUp() {
  AnsiString str = "0x";
  if (regSR->EditText[3] == '1') { // if Supervisor mode
    regA8->Text = regA7->EditText;
    A[8] = StrToInt(str + regA8->EditText);
  } else {
    regUS->Text = regA7->EditText;
    A[7] = StrToInt(str + regA7->EditText);
  }
  StackFrm->updateDisplay();
}

// SIM68Ku.cpp:1165
void TForm1::regUSKeyUp() {
  AnsiString str = "0x";
  if (regSR->EditText[3] == '0') // if User mode
    regA7->Text = regUS->EditText;
  A[7] = StrToInt(str + regUS->EditText);
  StackFrm->updateDisplay();
}

// SIM68Ku.cpp:1176
void TForm1::regA8KeyUp() {
  AnsiString str = "0x";
  if (regSR->EditText[3] == '1') // if Supervisor mode
    regA7->Text = regA8->EditText;
  A[8] = StrToInt(str + regA8->EditText);
  StackFrm->updateDisplay();
}

// Clear Cycles button pressed                                (SIM68Ku.cpp:1256)
void TForm1::ClearCyclesClick() {
  AnsiString str;

  cycles = 0;
  cyclesDisplay->Caption = str.sprintf("%u", (unsigned int)cycles);
}

// ---------------------------------------------------------------------------
// Open program file                                          (SIM68Ku.cpp:270)
//
// name is used for messages and the caption only.  The S-record text and the
// listing text have been staged by sim_open_file(); listingExists stands for
// FileExists(<name>.L68).
// ---------------------------------------------------------------------------
void TForm1::OpenFile(const AnsiString &name, bool listingExists) {
  AnsiString str;
  int addr;

  initSim(); // initialize simulator

  memset(memory, 0xFF, MEMSIZE); // erase 68000 memory to $FF

  // set toggle switch memory to 0
  str = "0x";
  memory[StrToInt(str + Hardware->switchAddr->EditText)] = 0x00;

  Hardware->initialize();
  simhalt_on = true; // default to SIMHALT enabled

  try {
    Message->Lines->Clear();
    ListBox1->Items->Clear();

    // load S-Record file
    if (loadSrec((char *)name.c_str()) == false) { // if S-Record loads with no errors
      startPC = PC;                                // save PC starting address for Reset
      // (Reload1->Enabled = true: the host enables its Reload command)

      // load Listing file
      if (listingExists) {
        loadListing(ListBox1->Items, easy68k_listing_data, easy68k_listing_length);

        // set PC to address in first line of listing
        str = ListBox1->Items->Strings[0];
        str = str.SubString(1, 8);
        if (str >= "00000000" && str < "01000000") // *ck 12-3-2005
          regPC->EditText = str;
        startPC = PC = StrToInt("0x" + regPC->EditText);

        // scan listing file for *[sim68k] commands
        // A comment line that has the following form will
        // automatically set an option in Sim68K
        //
        // *[sim68k]break      sets a PC breakpoint on the following line of code:
        // *[sim68k]bitfield   enables support for bitfield instructions
        // *[sim68k]SIMHALT_OFF disables SIMHALT, line FFFF performs as expected
        //
        for (int i = 0; i < ListBox1->Items->Count; i++) {
          str = ListBox1->Items->Strings[i].LowerCase(); // force str to lowercase
          if (str.SubString(41, 14) == "*[sim68k]break") { // if break set
            // get text from following line
            str = ListBox1->Items->Strings[i + 1];
            // if valid address on this line
            if (i + 1 > 2 && isInstruction(str)) // if instruction
            {
              addr = StrToInt("0x" + str.SubString(1, 8)); // get address from line
              BreaksFrm->sbpoint(addr);                   // set break point
            }
          }
          if (str.SubString(41, 17) == "*[sim68k]bitfield") { // if bitfield enabled
            bitfield = true;
            BitFieldEnabled->Checked = true;
          }
          if (str.SubString(41, 20) == "*[sim68k]simhalt_off") { // if turn off SIMHALT
            simhalt_on = false; // program control only (default is on)
          }
        }

      } else { // no .L68 file
        regPC->Text = str.sprintf("%08lX", PC); // set display PC
        Message->Lines->Add("Unable to open .L68 file.");
        ListBox1->Items->Add("A matching .L68 file was not found. The .L68 file");
        ListBox1->Items->Add("is used to provide source level debugging.");
        ListBox1->Items->Add("");
        ListBox1->Items->Add("Use EASy68K to assemble the source file to create");
        ListBox1->Items->Add("a properly formatted .L68 file and make sure the");
        ListBox1->Items->Add(".L68 and .S68 files are in the same directory.");
        ListBox1->Items->Add("");
        ListBox1->Items->Add("You may run the program without an .L68 file but");
        ListBox1->Items->Add("source level debugging will not be available.");
      }
      // display file name in title bar
      host_caption(name.c_str(), name.Length());

      BreaksFrm->Repaint();
      MemoryFrm->Repaint();
    } // end if
  } catch (...) {
    Form1->Message->Lines->Add(errstr.sprintf("Unexpected error in OpenFile"));
    return;
  }
}

// ---------------------------------------------------------------------------
// run commands
// ---------------------------------------------------------------------------
// Run                                                        (SIM68Ku.cpp:441)
void TForm1::RunExecute() {
  setMenuTrace();          // disable some commands
  BreaksFrm->resetDebug(); // Reset break condition counters
  trace = false;
  sstep = false;
  loadRegs();              // load registers from screen
  runMode = true;          // enable runLoop()
  runModeSave = runMode;   // save current runMode
  simIO->BringToFront();   // display the output form (if it is visible)
  Hardware->autoIRQon();   // enable auto interrupt timers
  // runLoop();  -> the host calls sim_run()
}

// SIM68Ku.cpp:468.  itemIndex is ListBox1->ItemIndex, the selected listing line.
void TForm1::RunToCursorExecute(int itemIndex) {
  int i, addr;
  AnsiString str;

  ListBox1->ItemIndex = itemIndex;
  try {
    // get text from Highlighted line
    str = ListBox1->Items->Strings[ListBox1->ItemIndex];

    // if valid address on this line
    if (ListBox1->ItemIndex > 2 && isInstruction(str)) {
      addr = StrToInt("0x" + str.SubString(1, 8)); // get address from line

      // is this address a break point?
      for (i = 0; i < bpoints; i++)
        if (brkpt[i] == addr) break;
      if (i >= bpoints)    // if this address is not already a break point
        runToAddr = addr;  // set runToAddress for break point
    } else
      Application->MessageBox("Selected line does not have a valid address.", NULL, MB_OK);
  } catch (...) {
    Application->MessageBox("Invalid Run-To-Cursor Selection", NULL, MB_OK);
  }
  RunExecute();
}

// SIM68Ku.cpp:501
void TForm1::StepExecute() {
  setMenuTrace(); // disable some commands
  trace = true;
  sstep = true;
  stepToAddr = 0; // reset step to address

  loadRegs();            // load registers from screen
  runMode = true;        // enable runLoop()
  runModeSave = runMode; // save current runMode
  // runLoop();  -> the host calls sim_run()
}

// SIM68Ku.cpp:525
void TForm1::PauseExecute() {
  trace = true;
  sstep = false;
  runMode = false;
  if (inputMode) {
    inputMode = false;    // disable input mode  ck v2.3
    simIO->erasePrompt(); //                     ck v2.3
  }
  scrshow(); // update the screen
  setMenuActive();
  // the next two lines must be after setMenuActive()
  AutoTraceTimer->Enabled = false; // turn off auto trace
  Hardware->autoIRQoff();          // turn off auto interrupt timers
}

// SIM68Ku.cpp:542
void TForm1::RewindExecute() {
  AutoTraceTimer->Enabled = false; // turn off auto trace
  PC = startPC;
  initSim(); // initialize simulator, sets runMode to false
  setMenuActive();
  Log->addMessage("\n***** Reset Program Pressed *****\n");
}

// SIM68Ku.cpp:426 (after the user confirmed the "Caution" box)
void TForm1::CloseExecute() {
  ListBox1->Clear();      // clear program
  initSim();              // initialize simulator
  BreaksFrm->cbpoint(-1); // clear all break points
}
