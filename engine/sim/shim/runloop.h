// easy68k-mac: runloop.h - run-control state shared by the shim files.
// (The hooks called from the patched original files are in easy68k.h.)
#ifndef EASY68K_RUNLOOP_H
#define EASY68K_RUNLOOP_H

#include "easy68k.h"

// ---- wait states ---------------------------------------------------------------
// Number of 10 ms periods left of a TRAP #15 task 23 delay (0 = none).
extern unsigned int easy68k_delay_remaining;
// True while the TRAP #15 task 58 file dialog is "open" (host has not replied).
extern bool easy68k_host_request_pending;
// True from Application->MessageBox() until sim_alert_dismissed().
extern bool easy68k_alert_open;
// True while the runprog() of an auto-trace tick is suspended.
extern bool easy68k_auto_trace_pending;
// Number of completed runprog() steps since start-up (wraps at 2^32).  Not in
// the original; lets a host count instructions for budgets and throttling.
extern unsigned int easy68k_step_count;

// Application->MessageBox(text, title, MB_OK): tell the host, remember that a
// box is open.
void easy68k_alert(const char *title, const char *text);

// The run loop (TForm1::runLoop, SIM68Ku.cpp:249) and one Trace Into step.
int easy68k_run_loop(int maxInstructions);
int easy68k_trace_step();
// After Pause, Rewind, a program load or Close arrived while a step was
// suspended: run the rest of that step now, as the original does when its
// wait loop ends (it does nothing if no step is suspended, or if the step
// still has to wait for a dialog or a message box).
void easy68k_finish_suspended_step();

// ---- the S-record text of the program being loaded -----------------------------
// loadSrec() opens its file with fopen(name, "rt").  The host hands the file
// over as bytes; easy68k_fopen() serves them with the text-mode translation
// of the Borland C library.
void easy68k_stage_srecord(const unsigned char *data, int length); // NULL = no such file

// ---- execution-log sink ----------------------------------------------------------
// ElogFile always points at this stream; what is written to it reaches the
// host (host_log_write) only while a log is open.
void easy68k_log_init();
void easy68k_log_open(bool open);

#endif
