// easy68k-mac: api.cpp - the exported functions (see api.h).
#include <emscripten/emscripten.h>

#include "extern.h"
#include "SIM68Ku.h"
#include "simIOu.h"
#include "hardwareu.h"
#include "logU.h"
#include "Optionsu.h"
#include "BREAKPOINTSu.h"
#include "host.h"
#include "runloop.h"
#include "api.h"

#define EXPORT extern "C" EMSCRIPTEN_KEEPALIVE

extern AnsiString errstr;                // var.h
extern bool easy68k_mem_live;            // misc.cpp
extern unsigned int easy68k_log_mem_from, easy68k_log_mem_bytes; // log.cpp
extern const unsigned char *easy68k_listing_data; // form1.cpp
extern int easy68k_listing_length;
unsigned int easy68k_hw_interval_box();  // hardware.cpp

// ---------------------------------------------------------------------------
// 68000 memory.  The original allocates exactly MEMSIZE bytes and can read or
// write a little past the end (a long access at $FFFFFE, string functions on
// text near the top of memory; PATCHES.md, "Reads and writes outside
// objects").  The extra bytes here take those accesses; they start as zero
// and are never 68000 memory.
// ---------------------------------------------------------------------------
enum { MEMORY_PADDING = 0x10000 };
static char memoryBlock[MEMSIZE + MEMORY_PADDING];

static bool booted = false;

// A command that ran into an exception the original has no handler for: the
// VCL shows it in a message box and carries on.
static void unhandled(const char *what) { easy68k_alert("Error", what); }
#define GUARDED(statement)                                                     \
  try {                                                                        \
    statement;                                                                 \
  } catch (EConvertError &) {                                                  \
    unhandled("The text is not a valid integer value.");                       \
  } catch (...) {                                                              \
    unhandled("Stack overflow");                                               \
  }

// ---------------------------------------------------------------------------
// life cycle
// ---------------------------------------------------------------------------
EXPORT void sim_boot(void) {
  if (booted) return;
  booted = true;
  // TForm1::TForm1 (SIM68Ku.cpp:122-175)
  runMode = false;
  memory = memoryBlock;
  memset(memory, 0xFF, MEMSIZE); // erase 68000 memory to $FF
  easy68k_log_init();
  // TForm1::FormShow (SIM68Ku.cpp:1203-1210): LoadSettings() starts from
  // defaultSettings(); the host applies its saved settings afterwards.
  Form1->defaultSettings();
  initSim();
}

EXPORT unsigned char *sim_memory(void) { return (unsigned char *)memoryBlock; }
EXPORT void *sim_regs(void) { return &easy68k_regs; }

// ---------------------------------------------------------------------------
// loading
// ---------------------------------------------------------------------------
static struct {
  unsigned char *data;
  int length;
} staged[2];

EXPORT unsigned char *sim_stage(int which, int length) {
  if (which < 0 || which > 1 || length < 0) return NULL;
  free(staged[which].data);
  staged[which].data = (unsigned char *)malloc((size_t)length + 1);
  staged[which].length = staged[which].data ? length : 0;
  return staged[which].data;
}

static void unstage() {
  for (int i = 0; i < 2; i++) {
    free(staged[i].data);
    staged[i].data = NULL;
    staged[i].length = 0;
  }
  easy68k_stage_srecord(NULL, 0);
  easy68k_listing_data = NULL;
  easy68k_listing_length = 0;
}

EXPORT void sim_open_file(const char *name, int kind) {
  easy68k_stage_srecord(staged[SIM_STAGE_S68].data, staged[SIM_STAGE_S68].length);
  easy68k_listing_data = staged[SIM_STAGE_L68].data;
  easy68k_listing_length = staged[SIM_STAGE_L68].length;
  bool listingExists = staged[SIM_STAGE_L68].data != NULL;
  GUARDED(
    if (kind == SIM_OPEN_MENU) BreaksFrm->cbpoint(-1); // OpenExecute: clear all break points
    Form1->OpenFile(name, listingExists);
    if (kind == SIM_OPEN_RELOAD)
      Log->addMessage("\n***** Reload Program Pressed *****\n"); // ReloadExecute
    else
      Log->setLogFileNames(); // OpenExecute, WmDropFiles, FormShow
  )
  unstage();
  easy68k_finish_suspended_step();
}

// OpenDataExecute, SIM68Ku.cpp:379
EXPORT int sim_open_data(const char *name) {
  int result = FAILURE;
  easy68k_stage_srecord(staged[SIM_STAGE_S68].data, staged[SIM_STAGE_S68].length);
  try {
    // load S-Record data file
    result = loadSrec((char *)name);
  } catch (...) {
    Form1->Message->Lines->Add(errstr.sprintf("Unexpected error in OpenDataExecute"));
  }
  unstage();
  return result;
}

EXPORT void sim_close_file(void) {
  GUARDED(Form1->CloseExecute())
  easy68k_finish_suspended_step();
}
EXPORT void sim_rewind(void) {
  GUARDED(Form1->RewindExecute())
  easy68k_finish_suspended_step();
}

// ---------------------------------------------------------------------------
// run control
// ---------------------------------------------------------------------------
EXPORT void sim_cmd_run(void) { GUARDED(Form1->RunExecute()) }
EXPORT void sim_cmd_run_to_cursor(int listingLine) { GUARDED(Form1->RunToCursorExecute(listingLine)) }
EXPORT void sim_cmd_run_to_address(int addr) {
  int i;
  // is this address a break point?  (SIM68Ku.cpp:482-487)
  for (i = 0; i < bpoints; i++)
    if (brkpt[i] == addr) break;
  if (i >= bpoints)   // if this address is not already a break point
    runToAddr = addr; // set runToAddress for break point
  GUARDED(Form1->RunExecute())
}
EXPORT void sim_cmd_step_over(void) { GUARDED(Form1->StepExecute()) }
EXPORT void sim_cmd_pause(void) {
  GUARDED(Form1->PauseExecute())
  easy68k_finish_suspended_step();
}
EXPORT void sim_cmd_auto_trace(void) { Form1->AutoTraceTimer->Enabled = true; }

// TForm1::TraceExecute, SIM68Ku.cpp:515
EXPORT int sim_cmd_trace(void) {
  if (easy68k_phase != EASY68K_PH_IDLE) return SIM_BUSY;
  if (easy68k_alert_open) return SIM_WAIT_ALERT; // a modal box is open: no command can be given yet
  try {
    Form1->setMenuTrace(); // disable some commands
    trace = true;
    sstep = false;
    Form1->loadRegs();     // load registers from screen
  } catch (...) {
    unhandled("The text is not a valid integer value.");
    return SIM_WAIT_ALERT;
  }
  return easy68k_trace_step(); // runprog();
}

// TForm1::AutoTraceTimerTimer, SIM68Ku.cpp:1339
EXPORT int sim_auto_trace_tick(void) {
  if (Form1->AutoTraceTimer->Enabled && !inputMode) {
    if (!autoTraceInProgress) {
      autoTraceInProgress = true; // prevent calling until finished
      int status = sim_cmd_trace();
      if (easy68k_phase != EASY68K_PH_IDLE) {
        easy68k_auto_trace_pending = true; // cleared when the suspended step is complete
        return status;
      }
      autoTraceInProgress = false;
      return status;
    }
  }
  if (easy68k_phase != EASY68K_PH_IDLE) return SIM_BUSY;
  return runMode ? SIM_RUNNING : SIM_STOPPED;
}

EXPORT int sim_run(int maxInstructions) { return easy68k_run_loop(maxInstructions); }
EXPORT unsigned int sim_step_count(void) { return easy68k_step_count; }

// ---------------------------------------------------------------------------
// ending a wait state
// ---------------------------------------------------------------------------
EXPORT void sim_alert_dismissed(void) { easy68k_alert_open = false; }
EXPORT unsigned int sim_delay_remaining(void) { return easy68k_delay_remaining; }
EXPORT void sim_delay_elapsed(unsigned int periods) {
  easy68k_delay_remaining -= (periods < easy68k_delay_remaining) ? periods : easy68k_delay_remaining;
}
EXPORT void sim_file_dialog_reply(int accepted, const char *fileName) {
  try {
    simIO->fileDialogReply(accepted != 0, fileName);
  } catch (...) {
    Form1->Message->Lines->Add(errstr.sprintf("Error in displayFileDialog"));
  }
}

// ---------------------------------------------------------------------------
// keyboard and mouse
// ---------------------------------------------------------------------------
EXPORT void sim_key_char(int ch) {
  char key = (char)ch;
  simIO->FormKeyPress(simIO, key);
}
EXPORT int sim_key_down(int virtualKey) {
  simIO->FormKeyDown(virtualKey);
  return disableKeyCommands ? 0 : 1;
}
EXPORT void sim_key_up(int virtualKey) { simIO->FormKeyUp(virtualKey); }
EXPORT void sim_io_activated(void) { simIO->clearKeys(); }
EXPORT void sim_mouse(int kind, int shiftState, int x, int y) {
  if (kind == SIM_MOUSE_DOWN) simIO->FormMouseDown(shiftState, x, y);
  else if (kind == SIM_MOUSE_UP) simIO->FormMouseUp(shiftState, x, y);
  else simIO->FormMouseMove(shiftState, x, y);
}

// ---------------------------------------------------------------------------
// CPU state
// ---------------------------------------------------------------------------
EXPORT int sim_reg_get(int reg) {
  if (reg >= SIM_D0 && reg <= SIM_D0 + 7) return D[reg - SIM_D0];
  if (reg >= SIM_A0 && reg <= SIM_A0 + 6) return A[reg - SIM_A0];
  switch (reg) {
    case SIM_USP: return A[7];
    case SIM_SSP: return A[8];
    case SIM_PC: return PC;
    case SIM_SR: return (int)(unsigned short)SR;
    case SIM_A7: return A[a_reg(7)];
    case SIM_OLD_PC: return OLD_PC;
  }
  return 0;
}

static AnsiString hex8(long value) {
  AnsiString str;
  return str.sprintf("%08lX", value);
}

EXPORT void sim_reg_set(int reg, int value) {
  AnsiString str;
  if (reg >= SIM_D0 && reg <= SIM_D0 + 7) {
    D[reg - SIM_D0] = value;
    Form1->regBox(SIM_BOX_D0 + reg - SIM_D0)->Text = hex8(value);
  } else if (reg >= SIM_A0 && reg <= SIM_A0 + 6) {
    A[reg - SIM_A0] = value;
    Form1->regBox(SIM_BOX_A0 + reg - SIM_A0)->Text = hex8(value);
  } else if (reg == SIM_USP) { // as regUSKeyUp
    Form1->regUS->Text = hex8(value);
    Form1->regUSKeyUp();
  } else if (reg == SIM_SSP) { // as regA8KeyUp
    Form1->regA8->Text = hex8(value);
    Form1->regA8KeyUp();
  } else if (reg == SIM_A7) {  // as regA7KeyUp
    Form1->regA7->Text = hex8(value);
    Form1->regA7KeyUp();
  } else if (reg == SIM_PC) {
    PC = value;
    Form1->regPC->Text = hex8(value);
  } else if (reg == SIM_SR) {
    SR = (short)value;
    for (int j = 15; j >= 0; j--) str += ((0x1 << j) & SR) ? "1" : "0";
    Form1->regSR->Text = str; // runs regSRChange: the A7 box follows the S bit
  }
}

EXPORT const char *sim_box_text(int box) {
  TMaskEdit *edit = Form1->regBox(box);
  return edit ? edit->Text.c_str() : "";
}

EXPORT int sim_box_edit(int box, const char *text) {
  TMaskEdit *edit = Form1->regBox(box);
  if (!edit) return 1;
  try {
    edit->Text = AnsiString(text); // OnChange runs for SR and PC
    if (box >= SIM_BOX_A0 && box <= SIM_BOX_A0 + 6) Form1->regAKeyUp(box - SIM_BOX_A0);
    else if (box == SIM_BOX_A7) Form1->regA7KeyUp();
    else if (box == SIM_BOX_US) Form1->regUSKeyUp();
    else if (box == SIM_BOX_SS) Form1->regA8KeyUp();
  } catch (...) {
    return 1; // StrToInt failed: the VCL would show "... is not a valid integer value"
  }
  return 0;
}

EXPORT unsigned int sim_cycles_lo(void) { return (unsigned int)cycles; }
EXPORT unsigned int sim_cycles_hi(void) { return (unsigned int)(cycles >> 32); }
EXPORT void sim_cycles_clear(void) { Form1->ClearCyclesClick(); }
EXPORT const char *sim_cycles_text(void) { return Form1->cyclesDisplay->Caption.c_str(); }

EXPORT int sim_state(int which) {
  switch (which) {
    case SIM_ST_RUN_MODE: return runMode;
    case SIM_ST_TRACE: return trace;
    case SIM_ST_SSTEP: return sstep;
    case SIM_ST_HALT: return halt;
    case SIM_ST_INPUT_MODE: return inputMode;
    case SIM_ST_HARDWARE_ENABLED: return hardwareEnabled;
    case SIM_ST_AUTO_IRQ: return autoIRQ;
    case SIM_ST_STOP_INSTRUCTION: return stopInstruction;
    case SIM_ST_LOGGING: return logging;
    case SIM_ST_AUTO_TRACE_TIMER: return Form1->AutoTraceTimer->Enabled;
    case SIM_ST_MENU_STATE: return Form1->menuState;
    case SIM_ST_PHASE: return easy68k_phase;
    case SIM_ST_IRQ: return irq;
    case SIM_ST_ALERT_OPEN: return easy68k_alert_open;
    case SIM_ST_PENDING_KEY: return (unsigned char)pendingKey;
    case SIM_ST_KEY_COMMANDS_DISABLED: return disableKeyCommands;
    case SIM_ST_START_PC: return Form1->startPC;
    case SIM_ST_ERRFLG: return errflg;
    case SIM_ST_STEP_TO_ADDR: return stepToAddr;
    case SIM_ST_RUN_TO_ADDR: return runToAddr;
    case SIM_ST_AUTO_TRACE_IN_PROGRESS: return autoTraceInProgress;
    case SIM_ST_HOST_REQUEST: return easy68k_host_request_pending;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// options
// ---------------------------------------------------------------------------
EXPORT void sim_set_option(int option, int value) {
  switch (option) {
    case SIM_OPT_EXCEPTIONS: // ExceptionsEnabledClick, SIM68Ku.cpp:1271
      exceptions = value ? true : false;
      Form1->ExceptionsEnabled->Checked = value != 0;
      break;
    case SIM_OPT_BITFIELD: // BitFieldEnabledClick, SIM68Ku.cpp:2037
      bitfield = value != 0;
      Form1->BitFieldEnabled->Checked = value != 0;
      break;
    case SIM_OPT_SIMHALT: simhalt_on = value != 0; break;
    case SIM_OPT_ELOG_TYPE: ElogFlag = (char)value; break; // TLog::OKBtnClick
    case SIM_OPT_OLOG_TYPE: OlogFlag = (char)value; break;
    case SIM_OPT_LOG_MEM_FROM: easy68k_log_mem_from = (unsigned int)value; break;
    case SIM_OPT_LOG_MEM_BYTES: easy68k_log_mem_bytes = (unsigned int)value; break;
    case SIM_OPT_DISABLE_DISPLAY: AutoTraceOptions->DisableDisplay->Checked = value != 0; break;
    case SIM_OPT_MEM_LIVE: easy68k_mem_live = value != 0; break;
    case SIM_OPT_MAIN_MONITOR: Form1->Monitor->MonitorNum = value; break;
    case SIM_OPT_FULLSCREEN_MONITOR: FullScreenMonitor = (unsigned char)value; break;
    case SIM_OPT_FULLSCREEN: simIO->fullScreen = value != 0; break;
  }
}

EXPORT int sim_get_option(int option) {
  switch (option) {
    case SIM_OPT_EXCEPTIONS: return exceptions ? 1 : 0;
    case SIM_OPT_BITFIELD: return bitfield ? 1 : 0;
    case SIM_OPT_SIMHALT: return simhalt_on ? 1 : 0;
    case SIM_OPT_ELOG_TYPE: return ElogFlag;
    case SIM_OPT_OLOG_TYPE: return OlogFlag;
    case SIM_OPT_LOG_MEM_FROM: return (int)easy68k_log_mem_from;
    case SIM_OPT_LOG_MEM_BYTES: return (int)easy68k_log_mem_bytes;
    case SIM_OPT_DISABLE_DISPLAY: return AutoTraceOptions->DisableDisplay->Checked ? 1 : 0;
    case SIM_OPT_MEM_LIVE: return easy68k_mem_live ? 1 : 0;
    case SIM_OPT_MAIN_MONITOR: return Form1->Monitor->MonitorNum;
    case SIM_OPT_FULLSCREEN_MONITOR: return FullScreenMonitor;
    case SIM_OPT_FULLSCREEN: return simIO->fullScreen ? 1 : 0;
  }
  return 0;
}

EXPORT void sim_log_dialog_opened(void) { // TLog::FormShow, logU.cpp:278
  eLogType = ElogFlag;
  oLogType = OlogFlag;
}
EXPORT void sim_log_start(const char *timeStr) { Log->startLog(timeStr ? timeStr : ""); }
EXPORT void sim_log_stop(void) { Log->stopLog(); }

// ---------------------------------------------------------------------------
// hardware window
// ---------------------------------------------------------------------------
EXPORT int sim_irq(int level) {
  if (level >= 1 && level <= 7) Hardware->IRQprocess(level); // IRQ1 .. IRQ7 button
  return runMode ? 1 : 0;
}
EXPORT int sim_hw_reset(void) {
  GUARDED(Hardware->ResetBtnClick())
  return runMode ? 1 : 0;
}
EXPORT int sim_hw_timer_tick(int level) {
  if (level >= 1 && level <= 7) Hardware->timerTick(level);
  return runMode ? 1 : 0;
}
EXPORT void sim_hw_switch(int n) {
  if (n >= 0 && n <= 7) Hardware->switchClick(n);
}
EXPORT void sim_hw_button(int n, int down) {
  if (n < 0 || n > 7) return;
  if (down) Hardware->pbDown(n);
  else Hardware->pbUp(n);
}

static TMaskEdit *hardwareEdit(int control) {
  switch (control) {
    case SIM_HW_SEG7_ADDR: return Hardware->seg7addr;
    case SIM_HW_LED_ADDR: return Hardware->LEDaddr;
    case SIM_HW_SWITCH_ADDR: return Hardware->switchAddr;
    case SIM_HW_PB_ADDR: return Hardware->pbAddr;
    case SIM_HW_ROM_START: return Hardware->ROMStartEdit;
    case SIM_HW_ROM_END: return Hardware->ROMEndEdit;
    case SIM_HW_READ_START: return Hardware->ReadStartEdit;
    case SIM_HW_READ_END: return Hardware->ReadEndEdit;
    case SIM_HW_PROTECTED_START: return Hardware->ProtectedStartEdit;
    case SIM_HW_PROTECTED_END: return Hardware->ProtectedEndEdit;
    case SIM_HW_INVALID_START: return Hardware->InvalidStartEdit;
    case SIM_HW_INVALID_END: return Hardware->InvalidEndEdit;
  }
  return NULL;
}
static TCheckBox *hardwareCheck(int control) {
  switch (control) {
    case SIM_HW_ROM_CHK: return Hardware->ROMChk;
    case SIM_HW_READ_CHK: return Hardware->ReadChk;
    case SIM_HW_PROTECTED_CHK: return Hardware->ProtectedChk;
    case SIM_HW_INVALID_CHK: return Hardware->InvalidChk;
  }
  if (control >= SIM_HW_AUTO_CHK + 1 && control <= SIM_HW_AUTO_CHK + 7) return Hardware->CheckBox[control - SIM_HW_AUTO_CHK];
  return NULL;
}

EXPORT int sim_hw_set_text(int control, const char *text) {
  TMaskEdit *edit = hardwareEdit(control);
  if (!edit) return 1;
  try {
    edit->Text = AnsiString(text);
  } catch (...) {
    return 1; // StrToInt failed in the change handler
  }
  return 0;
}
EXPORT void sim_hw_commit(int control) {
  if (control == SIM_HW_SWITCH_ADDR) { GUARDED(Hardware->switchAddrCommit()) }
  else if (control == SIM_HW_PB_ADDR) Hardware->pbAddrCommit();
}
EXPORT void sim_hw_set_check(int control, int checked) {
  TCheckBox *box = hardwareCheck(control);
  if (box) box->Checked = checked != 0;
}
EXPORT void sim_hw_auto_select(int itemIndex) {
  Hardware->AutoIRQItemIndex = itemIndex;
  Hardware->AutoIRQChange();
}
EXPORT void sim_hw_auto_interval(unsigned int ms) { Hardware->IRQintervalSet(ms); }
EXPORT void sim_hw_set_visible(int visible) {
  if (visible) {
    if (!Hardware->Visible) {
      Hardware->Visible = true;
      Hardware->FormShow();
    }
  } else
    Hardware->Hide();
}
EXPORT int sim_hw_get(int what) {
  TMaskEdit *edit = hardwareEdit(what);
  if (edit) {
    try {
      return StrToInt("0x" + edit->EditText);
    } catch (...) {
      return -1;
    }
  }
  TCheckBox *box = hardwareCheck(what);
  if (box) return box->Checked ? 1 : 0;
  if (what >= SIM_HW_TIMER_ENABLED + 1 && what <= SIM_HW_TIMER_ENABLED + 7) return Hardware->IRQtimer[what - SIM_HW_TIMER_ENABLED]->enabled;
  if (what >= SIM_HW_TIMER_INTERVAL + 1 && what <= SIM_HW_TIMER_INTERVAL + 7) return (int)Hardware->IRQtimer[what - SIM_HW_TIMER_INTERVAL]->interval;
  if (what >= SIM_HW_SWITCH_ON && what <= SIM_HW_SWITCH_ON + 7) return Hardware->switchOn[what - SIM_HW_SWITCH_ON];
  if (what == SIM_HW_VISIBLE) return Hardware->Visible;
  if (what == SIM_HW_AUTO_SELECTED) return Hardware->AutoIRQItemIndex;
  if (what == SIM_HW_INTERVAL_BOX) return (int)easy68k_hw_interval_box();
  return 0;
}

// ---------------------------------------------------------------------------
// breakpoints
// ---------------------------------------------------------------------------
EXPORT int sim_bp_set(int addr) {
  int before = bpoints;
  bool present = false;
  for (int i = 0; i < bpoints; i++)
    if (brkpt[i] == addr) present = true;
  BreaksFrm->sbpoint(addr);
  return (present || bpoints > before) ? 0 : 1; // 1: table full
}
EXPORT void sim_bp_clear(int addr) { BreaksFrm->cbpoint(addr); }
EXPORT int sim_bp_count(void) { return bpoints; }
EXPORT int sim_bp_get(int index) { return (index >= 0 && index < bpoints) ? brkpt[index] : -1; }

EXPORT int sim_bp_cond_set(int index, int enabled, int id, int type, int typeId, int op, int value, int size, int readWrite) {
  if (index < 0 || index >= MAX_BPOINTS) return 1;
  BPoint &bp = breakPoints[index];
  bp.setId(id);
  bp.setType(type);
  bp.setTypeId(typeId);
  bp.setOperator(op);
  bp.setValue(value);
  bp.setSize(size);
  bp.setReadWrite(readWrite);
  bp.isEnabled(enabled != 0);
  return 0;
}

static int scratchInts[16];
EXPORT int *sim_scratch_ints(void) { return scratchInts; }

EXPORT int sim_bp_expr_set(int index, int enabled, int id, int count, const int *postfix, int n) {
  if (index < 0 || index >= MAX_BP_EXPR) return 1;
  if (n < 0 || n > MAX_LB_NODES) return 1;
  if (id < 0 || id >= MAX_BPOINTS) return 1; // id indexes bpCountCond[]
  // BPointExpr::isBreak() pops its operand stack without checking it; an
  // expression that would pop an empty stack is refused here instead
  // (PATCHES.md, "Uninitialised and stale values").
  int depth = 0;
  for (int i = 0; i < n; i++) {
    if (postfix[i] >= 0 && postfix[i] < MAX_BPOINTS) depth++;
    else {
      if (depth < 2) return 1;
      depth--;
    }
  }
  if (enabled && depth < 1) return 1;
  BPointExpr &expr = bpExpressions[index];
  expr.setId(id);
  expr.setPostfixExpr((int *)postfix, n);
  expr.setCount(count);
  expr.isEnabled(enabled != 0);
  return 0;
}

EXPORT void sim_bp_counts(int regs, int addrs, int exprs) {
  regCount = regs;
  addrCount = addrs;
  exprCount = (exprs < 0) ? 0 : (exprs > MAX_BP_EXPR ? MAX_BP_EXPR : exprs);
}

// ---------------------------------------------------------------------------
// listing
// ---------------------------------------------------------------------------
EXPORT int sim_listing_count(void) { return Form1->ListBox1->Items->Count; }
EXPORT const char *sim_listing_line(int index) {
  if (index < 0 || index >= Form1->ListBox1->Items->Count) return "";
  return Form1->ListBox1->Items->Strings[index].c_str();
}
EXPORT int sim_listing_line_length(int index) {
  if (index < 0 || index >= Form1->ListBox1->Items->Count) return 0;
  return Form1->ListBox1->Items->Strings[index].Length();
}
EXPORT int sim_listing_highlight(void) { return Form1->ListBox1->ItemIndex; }
