// easy68k-mac: easy68k.h - the hooks that the marked changes in the original
// core files call (RUN.CPP, UTILS.CPP, CODE9.CPP).  Implemented in
// shim/runloop.cpp.  See README.md, "Wait states", and PATCHES.md.
#ifndef EASY68K_H
#define EASY68K_H

// ---- status codes ------------------------------------------------------------
// Returned by sim_run() and the other exported functions that execute 68000
// code.  A SIM_WAIT_* code means: the original program would be blocked at
// this point; the step in progress is suspended and continues when sim_run()
// is called again after the host has done its part.
enum {
  SIM_RUNNING = 0,     // instruction budget used up; runMode is still true
  SIM_STOPPED = 1,     // runMode is false (trace step done, breakpoint, halt, pause)
  SIM_WAIT_INPUT = 2,  // keyboard read pending (RUN.CPP:646-650, inputMode && runMode)
  SIM_WAIT_DELAY = 3,  // TRAP #15 task 23 delay in progress (CODE9.CPP:879-885)
  SIM_WAIT_HOST = 4,   // TRAP #15 task 58 file dialog open (simIOu.cpp:512, 542)
  SIM_WAIT_ALERT = 5,  // a modal message box is open (Application->MessageBox)
  SIM_ERROR = 6,       // internal error ended the run loop ("Unexpected error in runLoop")
  SIM_BUSY = -1        // command refused: a suspended step must be finished first
};

// ---- where runprog() continues -------------------------------------------------
enum {
  EASY68K_PH_IDLE = 0, // between instructions
  EASY68K_PH_EXEC = 1, // inside exec_inst() (waiting inside the instruction)
  EASY68K_PH_PUMP = 2  // at the message loop after exec_inst() (waiting for input)
};
extern int easy68k_phase;
// 0, or the wait point inside exec_inst() to continue from (RUN.CPP).
extern int easy68k_exec_resume;

// exec_inst() wrapped in the try/catch that the original had inside it.
int easy68k_exec_inst();
// The original catch handler of exec_inst (RUN.CPP).
int exec_inst_catch();

// Wait requested by the instruction handler that just ran: SIM_WAIT_ALERT,
// SIM_WAIT_DELAY, SIM_WAIT_HOST, or 0 to carry on.
int easy68k_wait_in_handler();
// SIM_WAIT_ALERT while a message box is open, else 0.
int easy68k_wait_alert();
// The message loop of runprog(): SIM_WAIT_ALERT, or SIM_WAIT_INPUT while
// (inputMode && runMode), else 0.
int easy68k_wait_pump();

// TRAP #15 task 23: start a delay of n hundredths of a second.
void easy68k_delay(unsigned int n);

// Recursion guard used by mem_req().  Throws EStackOverflow when the nesting
// goes beyond EASY68K_MAX_DEPTH.
enum { EASY68K_MAX_DEPTH = 1000 };
extern int easy68k_depth_count;
void easy68k_depth_overflow();
struct Easy68kDepth {
  Easy68kDepth() {
    if (++easy68k_depth_count > EASY68K_MAX_DEPTH) easy68k_depth_overflow();
  }
  ~Easy68kDepth() { --easy68k_depth_count; }
};

#endif
