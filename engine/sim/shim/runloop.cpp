// easy68k-mac: runloop.cpp - the run loop without blocking.
//
// The original executes a program with
//
//     TForm1::runLoop():  while (runMode) { runprog(); Application->ProcessMessages(); }
//
// and blocks in four kinds of places: the wait for keyboard input in
// runprog(), the delay loop of TRAP #15 task 23, modal dialogs (task 58) and
// modal message boxes.  Here each of those places returns a status code to
// the host instead (SIM_WAIT_*, easy68k.h) and the same step continues at the
// next call.  runprog() and exec_inst() in RUN.CPP carry the marked changes
// that make them resumable; this file holds the state and the loop.
#include "extern.h"
#include "SIM68Ku.h"
#include "host.h"
#include "runloop.h"

extern AnsiString errstr; // var.h
int exec_inst();          // RUN.CPP

int easy68k_phase = EASY68K_PH_IDLE;
int easy68k_exec_resume = 0;
unsigned int easy68k_delay_remaining = 0;
bool easy68k_host_request_pending = false;
bool easy68k_alert_open = false;
bool easy68k_auto_trace_pending = false;
int easy68k_depth_count = 0;
unsigned int easy68k_step_count = 0;

// ---- recursion guard (mem_req, UTILS.CPP) --------------------------------------
void easy68k_depth_overflow() {
  --easy68k_depth_count; // the constructor that called us will not be matched by a destructor
  throw EStackOverflow();
}

// ---- message boxes ---------------------------------------------------------------
void easy68k_alert(const char *title, const char *text) {
  easy68k_alert_open = true;
  host_alert(title, text);
}

// ---- hooks called from RUN.CPP and CODE9.CPP -------------------------------------
int easy68k_exec_inst() {
  // RUN.CPP:756 "try {" ... RUN.CPP:1008 "} catch( ... ) {"
  try {
    return exec_inst();
  } catch (...) {
    easy68k_exec_resume = 0;
    exec_inst_catch();
    return 0;
  }
}

int easy68k_wait_alert() { return easy68k_alert_open ? SIM_WAIT_ALERT : 0; }

int easy68k_wait_in_handler() {
  if (easy68k_alert_open) return SIM_WAIT_ALERT;
  if (easy68k_delay_remaining > 0) {
    // CODE9.CPP:881  while(n-- > 0 && runMode)
    if (runMode) return SIM_WAIT_DELAY;
    easy68k_delay_remaining = 0;
  }
  if (easy68k_host_request_pending) return SIM_WAIT_HOST;
  return 0;
}

int easy68k_wait_pump() {
  if (easy68k_alert_open) return SIM_WAIT_ALERT;
  // RUN.CPP:646-650  do { ... } while (inputMode && runMode);
  if (inputMode && runMode) return SIM_WAIT_INPUT;
  return 0;
}

void easy68k_delay(unsigned int n) { easy68k_delay_remaining = n; }

// ---- the loops ---------------------------------------------------------------------
static void stepFinished() {
  easy68k_step_count++;
  if (easy68k_auto_trace_pending) {
    // SIM68Ku.cpp:1347, after the TraceExecute() of an auto-trace tick
    autoTraceInProgress = false;
    easy68k_auto_trace_pending = false;
  }
}

static void abandonStep() {
  easy68k_phase = EASY68K_PH_IDLE;
  easy68k_exec_resume = 0;
  stepFinished();
}

// TForm1::runLoop(), SIM68Ku.cpp:249-266.  The "running" re-entrancy guard is
// not needed: nothing can call into the engine while this function runs.
// Host events arrive between calls, i.e. where the original has the
// ProcessMessages() of this loop.
int easy68k_run_loop(int maxInstructions) {
  try {
    for (;;) {
      if (easy68k_phase == EASY68K_PH_IDLE) {
        if (easy68k_alert_open) return SIM_WAIT_ALERT;
        if (!runMode) return SIM_STOPPED;
        if (maxInstructions-- <= 0) return SIM_RUNNING;
      }
      int wait = runprog(); // run next 68000 instruction (or continue a suspended one)
      if (wait) return wait;
      stepFinished();
    }
  } catch (...) {
    abandonStep();
    Form1->Message->Lines->Add(errstr.sprintf("Unexpected error in runLoop"));
    return SIM_ERROR;
  }
}

// In the original, Pause / Rewind / Open / Close issued while a program waits
// (for a key, in a delay) are handled inside that wait's message loop.  The
// handler changes the state (runMode = false, or a whole reset), returns, and
// the wait loop ends at once because its condition is no longer true: the
// interrupted runprog() runs its remaining statements on the new state before
// anything else can happen.  This function is that continuation.
void easy68k_finish_suspended_step() {
  if (easy68k_phase == EASY68K_PH_IDLE) return;
  try {
    if (runprog() == 0) stepFinished();
  } catch (...) {
    abandonStep();
    Form1->Message->Lines->Add(errstr.sprintf("Unexpected error in runLoop"));
  }
}

// The runprog() call of TForm1::TraceExecute (SIM68Ku.cpp:521).  The original
// has no try/catch there; an exception would end in the VCL's default handler,
// which shows the error in a message box.
int easy68k_trace_step() {
  if (easy68k_phase != EASY68K_PH_IDLE) return SIM_BUSY;
  if (easy68k_alert_open) return SIM_WAIT_ALERT;
  try {
    int wait = runprog();
    if (wait) return wait;
  } catch (...) {
    abandonStep();
    easy68k_alert("Error", "Stack overflow");
    return SIM_WAIT_ALERT;
  }
  stepFinished();
  if (easy68k_alert_open) return SIM_WAIT_ALERT;
  return runMode ? SIM_RUNNING : SIM_STOPPED;
}
