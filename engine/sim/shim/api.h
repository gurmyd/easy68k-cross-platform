// easy68k-mac: api.h - the functions the engine exports to its host.
//
// sim68k.mjs wraps every one of these in a JavaScript method and documents
// them for users of the engine; this header is the C-level reference.  Each
// export corresponds to something a user (or a timer, or the keyboard) does to
// the original program; the comment names the original handler.
//
// Calling rules: the engine is single-threaded and not re-entrant.  A host
// event (key, mouse, interrupt request, Pause ...) is delivered by calling
// the matching export between two calls of sim_run(), never from inside an
// import.  That is where the original delivers it too: in a message loop
// between two instructions.
#ifndef EASY68K_API_H
#define EASY68K_API_H

#include "easy68k.h" // SIM_* status codes

#ifdef __cplusplus
extern "C" {
#endif

// ---- registers (sim_reg_get / sim_reg_set) --------------------------------------
enum {
  SIM_D0 = 0, /* ..SIM_D7 = 7 */
  SIM_A0 = 8, /* ..SIM_A6 = 14 */
  SIM_USP = 15, // A[7]
  SIM_SSP = 16, // A[8]
  SIM_PC = 17,
  SIM_SR = 18,
  SIM_A7 = 19,  // A[a_reg(7)]: the active stack pointer
  SIM_OLD_PC = 20 // read-only
};

// ---- register text boxes of the main window (sim_box_text / sim_box_edit) -----
enum {
  SIM_BOX_D0 = 0, /* ..SIM_BOX_D7 = 7 */
  SIM_BOX_A0 = 8, /* ..SIM_BOX_A6 = 14 */
  SIM_BOX_A7 = 15,
  SIM_BOX_US = 16,
  SIM_BOX_SS = 17,
  SIM_BOX_PC = 18,
  SIM_BOX_SR = 19, // 16 binary digits
  SIM_BOX_COUNT = 20
};

// ---- sim_state() -------------------------------------------------------------------
enum {
  SIM_ST_RUN_MODE = 0,
  SIM_ST_TRACE = 1,
  SIM_ST_SSTEP = 2,
  SIM_ST_HALT = 3,
  SIM_ST_INPUT_MODE = 4,
  SIM_ST_HARDWARE_ENABLED = 5,
  SIM_ST_AUTO_IRQ = 6,
  SIM_ST_STOP_INSTRUCTION = 7,
  SIM_ST_LOGGING = 8,
  SIM_ST_AUTO_TRACE_TIMER = 9,
  SIM_ST_MENU_STATE = 10,
  SIM_ST_PHASE = 11,
  SIM_ST_IRQ = 12,
  SIM_ST_ALERT_OPEN = 13,
  SIM_ST_PENDING_KEY = 14,
  SIM_ST_KEY_COMMANDS_DISABLED = 15,
  SIM_ST_START_PC = 16,
  SIM_ST_ERRFLG = 17,
  SIM_ST_STEP_TO_ADDR = 18,
  SIM_ST_RUN_TO_ADDR = 19,
  SIM_ST_AUTO_TRACE_IN_PROGRESS = 20,
  SIM_ST_HOST_REQUEST = 21
};

// ---- sim_set_option() / sim_get_option() --------------------------------------------
enum {
  SIM_OPT_EXCEPTIONS = 0,     // Options > Enable Exceptions
  SIM_OPT_BITFIELD = 1,       // Options > Enable Bit Field Instructions
  SIM_OPT_SIMHALT = 2,        // simhalt_on (the original has no menu item; listing directive only)
  SIM_OPT_ELOG_TYPE = 3,      // Log Output dialog: execution log type 0..3 (ElogFlag)
  SIM_OPT_OLOG_TYPE = 4,      // Log Output dialog: output log type 0..1 (OlogFlag)
  SIM_OPT_LOG_MEM_FROM = 5,   // Log Output dialog: memory range, From
  SIM_OPT_LOG_MEM_BYTES = 6,  // Log Output dialog: memory range, Bytes
  SIM_OPT_DISABLE_DISPLAY = 7,// Auto Trace Options > Disable display update
  SIM_OPT_MEM_LIVE = 8,       // send host_mem_live_paint for every memory write
  SIM_OPT_MAIN_MONITOR = 9,   // Form1->Monitor->MonitorNum
  SIM_OPT_FULLSCREEN_MONITOR = 10, // FullScreenMonitor
  SIM_OPT_FULLSCREEN = 11     // simIO->fullScreen
};

// ---- sim_hw_set_text() / sim_hw_set_check() / sim_hw_get() ---------------------------
enum {
  SIM_HW_SEG7_ADDR = 0, SIM_HW_LED_ADDR = 1, SIM_HW_SWITCH_ADDR = 2, SIM_HW_PB_ADDR = 3,
  SIM_HW_ROM_START = 4, SIM_HW_ROM_END = 5, SIM_HW_READ_START = 6, SIM_HW_READ_END = 7,
  SIM_HW_PROTECTED_START = 8, SIM_HW_PROTECTED_END = 9, SIM_HW_INVALID_START = 10, SIM_HW_INVALID_END = 11,
  SIM_HW_ROM_CHK = 20, SIM_HW_READ_CHK = 21, SIM_HW_PROTECTED_CHK = 22, SIM_HW_INVALID_CHK = 23,
  SIM_HW_AUTO_CHK = 30,       // + level 1..7
  SIM_HW_TIMER_ENABLED = 40,  // + level 1..7 (read only)
  SIM_HW_TIMER_INTERVAL = 50, // + level 1..7 (read only)
  SIM_HW_SWITCH_ON = 60,      // + switch 0..7 (read only): picture shows "on"
  SIM_HW_VISIBLE = 70,
  SIM_HW_AUTO_SELECTED = 71,  // AutoIRQ->ItemIndex
  SIM_HW_INTERVAL_BOX = 72    // IRQinterval as a number
};

// ---- life cycle ------------------------------------------------------------------------
void sim_boot(void);                 // program start: TForm1::TForm1, THardware::FormCreate, TForm1::FormShow
unsigned char *sim_memory(void);     // the 16 MB of 68000 memory (index = address)
void *sim_regs(void);                // the register struct (shim/regblock.h)

// ---- loading (SIM68Ku.cpp:270-437) ---------------------------------------------------------
enum { SIM_STAGE_S68 = 0, SIM_STAGE_L68 = 1 };
// Reserve length bytes for the text of the .S68 (which = 0) or .L68 (1) file
// and return where to copy it.  Not calling this means "that file does not exist".
unsigned char *sim_stage(int which, int length);
enum { SIM_OPEN_MENU = 0, SIM_OPEN_RELOAD = 1, SIM_OPEN_DROP = 2 };
// OpenExecute after its dialog (kind 0: clears the PC breakpoints first),
// ReloadExecute (kind 1), WmDropFiles / command line (kind 2).
void sim_open_file(const char *name, int kind);
int sim_open_data(const char *name); // OpenDataExecute: loadSrec() only; returns its result
void sim_close_file(void);           // CloseExecute
void sim_rewind(void);               // RewindExecute

// ---- run control (SIM68Ku.cpp:441-549, 1333-1350) --------------------------------------------
void sim_cmd_run(void);              // RunExecute, without the loop
void sim_cmd_run_to_cursor(int listingLine); // RunToCursorExecute
// RunToCursorExecute for a host without a listing line to point at: what the
// original does once it has taken the address from the selected line.
void sim_cmd_run_to_address(int addr);
void sim_cmd_step_over(void);        // StepExecute, without the loop
int sim_cmd_trace(void);             // TraceExecute: executes one step, returns a status
void sim_cmd_pause(void);            // PauseExecute
void sim_cmd_auto_trace(void);       // AutoTraceExecute: AutoTraceTimer->Enabled = true
int sim_auto_trace_tick(void);       // AutoTraceTimerTimer; returns a status
int sim_run(int maxInstructions);    // TForm1::runLoop, at most maxInstructions new instructions
unsigned int sim_step_count(void);   // completed instruction steps since start-up, modulo 2^32

// ---- ending a wait state ----------------------------------------------------------------------
void sim_alert_dismissed(void);      // the user closed the message box(es)
unsigned int sim_delay_remaining(void); // task 23: 10 ms periods still to wait
void sim_delay_elapsed(unsigned int periods); // task 23: so many 10 ms periods have passed
void sim_file_dialog_reply(int accepted, const char *fileName); // task 58: dialog closed

// ---- keyboard and mouse of the I/O window (simIOu.cpp) --------------------------------------------
void sim_key_char(int ch);           // FormKeyPress: one character (WM_CHAR)
int sim_key_down(int virtualKey);    // FormKeyDown; returns 1 if the simulator key commands are enabled
void sim_key_up(int virtualKey);     // FormKeyUp
void sim_io_activated(void);         // FormActivate: clearKeys()
enum { SIM_MOUSE_DOWN = 0, SIM_MOUSE_UP = 1, SIM_MOUSE_MOVE = 2 };
void sim_mouse(int kind, int shiftState, int x, int y); // FormMouseDown / Up / Move

// ---- CPU state ----------------------------------------------------------------------------------
int sim_reg_get(int reg);
// Writes the register AND its text box, as if the value had been typed and
// taken over at once.  Does not touch OLD_PC.
void sim_reg_set(int reg, int value);
// The text a register box shows (8 hex digits; 16 binary digits for SR).
const char *sim_box_text(int box);
// Typing into a register box, exactly as in the original: D0-D7, SR and PC
// change only the text (it is copied to the CPU by the next Run / Step /
// Trace, and lost at the next display refresh); A0-A6, A7, US and SS are
// written through at once.  Returns 0, or 1 if the text is not a number.
int sim_box_edit(int box, const char *text);
unsigned int sim_cycles_lo(void);
unsigned int sim_cycles_hi(void);
void sim_cycles_clear(void);         // ClearCyclesClick
const char *sim_cycles_text(void);   // the cycle display ("Overflow" above 2^48-1)
int sim_state(int which);

// ---- options --------------------------------------------------------------------------------------
void sim_set_option(int option, int value);
int sim_get_option(int option);
void sim_log_dialog_opened(void);    // TLog::FormShow: remembers the log types (logU.cpp:278)
void sim_log_start(const char *timeStr); // TLog::startLog; timeStr = DateTimeToStr(Now())
void sim_log_stop(void);             // TLog::stopLog

// ---- hardware window (hardwareu.cpp) -----------------------------------------------------------------
int sim_irq(int level);              // IRQ1..IRQ7 button; returns runMode (1: call sim_run)
int sim_hw_reset(void);              // ResetBtnClick; returns runMode
int sim_hw_timer_tick(int level);    // IRQ<level>timer fired; returns runMode
void sim_hw_switch(int n);           // switch<n>Click
void sim_hw_button(int n, int down); // pb<n> pressed (1) / released (0)
int sim_hw_set_text(int control, const char *text); // the user changed an address or range box; 0 ok
void sim_hw_commit(int control);     // Enter / focus loss in the switch or push-button address box
void sim_hw_set_check(int control, int checked);    // the user (un)checked a box
void sim_hw_auto_select(int itemIndex);             // AutoIRQ combo box: 0..6 = IRQ 1..7
void sim_hw_auto_interval(unsigned int ms);         // IRQinterval edit box
void sim_hw_set_visible(int visible);               // window shown (FormShow) / hidden
int sim_hw_get(int what);

// ---- breakpoints (BREAKPOINTSu.cpp, BPoint.cpp, BPointExpr.cpp) ---------------------------------------
int sim_bp_set(int addr);            // sbpoint
void sim_bp_clear(int addr);         // cbpoint; -1 clears all
int sim_bp_count(void);
int sim_bp_get(int index);
// One row of the PC/Register table (index 0..49) or of the Address table (50..99).
int sim_bp_cond_set(int index, int enabled, int id, int type, int typeId, int op, int value, int size, int readWrite);
// One row of the Expression table (index 0..49).  postfix: n tokens; 0..99 =
// condition index, 100 = AND, 101 = OR.  Returns 0, or 1 if the row is refused.
int sim_bp_expr_set(int index, int enabled, int id, int count, const int *postfix, int n);
void sim_bp_counts(int regCount, int addrCount, int exprCount);
int *sim_scratch_ints(void);         // room for 16 ints (postfix tokens)

// ---- listing ------------------------------------------------------------------------------------------
int sim_listing_count(void);
const char *sim_listing_line(int index);
int sim_listing_line_length(int index);
int sim_listing_highlight(void);     // ListBox1->ItemIndex

#ifdef __cplusplus
}
#endif

#endif
