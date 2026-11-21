// easy68k-mac: misc.cpp - the small stand-ins: Memory window, Stack window,
// Breakpoints window, Auto Trace Options dialog, network shutdown.
#include "extern.h"
#include "SIM68Ku.h"
#include "Memory1.h"
#include "Stack1.h"
#include "Optionsu.h"
#include "BREAKPOINTSu.h"
#include "net.h"
#include "host.h"
#include "runloop.h"
#include "api.h"

// ---- Memory window --------------------------------------------------------------
static TMemoryFrm theMemoryFrm;
TMemoryFrm *MemoryFrm = &theMemoryFrm;
bool easy68k_mem_live = false; // SIM_OPT_MEM_LIVE

// Memory1.cpp:129.  The original repaints one row of the Memory window if the
// address is on screen and "Live" is checked.  Which rows are on screen is
// the host's knowledge, so the host switches the notification on or off as a
// whole.
void TMemoryFrm::LivePaint(unsigned int loc) {
  if (easy68k_mem_live) host_mem_live_paint(loc);
}
void TMemoryFrm::Repaint() { host_repaint(REPAINT_MEMORY); }

// ---- Stack window ---------------------------------------------------------------
static TStackFrm theStackFrm;
TStackFrm *StackFrm = &theStackFrm;
void TStackFrm::updateDisplay() { host_repaint(REPAINT_STACK); }
// Repaint() redraws the Stack window where it is; updateDisplay() also
// re-centres it on the selected register (sim-ui 11.4).  Repaint() names both
// bits, so a host that only knows REPAINT_STACK still redraws, and a host that
// counts REPAINT_STACK_REDRAW can tell the two apart: re-centre only when the
// STACK bit came more often than the STACK_REDRAW bit.
void TStackFrm::Repaint() { host_repaint(REPAINT_STACK | REPAINT_STACK_REDRAW); }

// ---- Auto Trace Options -----------------------------------------------------------
TAutoTraceOptions::TAutoTraceOptions() : DisableDisplay(new TCheckBox()) {}
static TAutoTraceOptions theAutoTraceOptions;
TAutoTraceOptions *AutoTraceOptions = &theAutoTraceOptions;

// ---- Breakpoints window (BREAKPOINTSu.cpp:112-165) ---------------------------------
static TBreaksFrm theBreaksFrm;
TBreaksFrm *BreaksFrm = &theBreaksFrm;

// Sets PC breakpoints only
int TBreaksFrm::sbpoint(int loc) // set break point
{
  int i;

  // set breakpoint in table and increment counter
  for (i = 0; i < bpoints; i++)
    if (brkpt[i] == loc) return SUCCESS;

  if (bpoints < 100)
    brkpt[(int)bpoints++] = loc;
  else
    Application->MessageBox("Breakpoint Limit Reached!", NULL, MB_OK);

  Form1->ListBox1->Repaint();
  return SUCCESS;
}

// Clears PC break points only
int TBreaksFrm::cbpoint(int loc) // clear break point
{
  int i, j;

  if (loc == -1) { // if clear all breakpoints
    bpoints = 0;   // clear index
  } else {         // else clear one breakpoint
    // find break point specified
    for (i = 0; i < bpoints; i++)
      if (brkpt[i] == loc) break;

    // The original decrements the counter even when loc is not in the table
    // (and then reads brkpt[-1] when the table is empty).  Its callers always
    // check first; here an unknown address is ignored so that the count cannot
    // go negative.
    if (i >= bpoints) return SUCCESS;

    --bpoints;                    // decrement counter
    for (j = i; j < bpoints; j++) // adjust breakpoint table
      brkpt[j] = brkpt[j + 1];
  }

  // refresh display
  Form1->ListBox1->Repaint();
  return SUCCESS;
}

void TBreaksFrm::resetDebug() {
  // Reset all breakpoint condition met counts to zero.
  for (int c = 0; c < MAX_BPOINTS; c++) bpCountCond[c] = 0;
}

void TBreaksFrm::Repaint() { host_repaint(REPAINT_BREAKPOINTS); }

// ---- network (Net.cpp) ---------------------------------------------------------------
int netCloseSockets() { return host_net_closeSockets(); }
