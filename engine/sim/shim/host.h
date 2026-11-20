// easy68k-mac: host.h - everything the simulator engine asks of its host.
//
// The original core called the Windows GUI (forms Form1, simIO, Hardware,
// Log, MemoryFrm, StackFrm) and the C library's files and clock directly.  In
// this port every such call ends in one of the functions below.  They are
// WebAssembly imports, implemented in shim/host-imports.js, which forwards
// each one to a method of the JavaScript "host" object given to createSim()
// (see the SimHost typedef in sim68k.mjs: one method per import).
//
// Rules for every import:
//   * it returns at once (the engine never blocks; see "Wait states" in
//     README.md for how the original's blocking calls are handled);
//   * it must not call back into the engine;
//   * text is passed as bytes (Windows-1252, as the 68000 program supplied
//     them), never as a decoded string;
//   * where the original wrote a result through a pointer into a 68000
//     register (for example (short *)&D[0]), the import takes the same
//     pointer and the glue writes exactly that width - and nothing at all if
//     the host method returns undefined, which is how "register unchanged"
//     is expressed.
#ifndef EASY68K_HOST_H
#define EASY68K_HOST_H

#ifdef __cplusplus
extern "C" {
#endif

// ---- main window (original: TForm1, SIM68Ku.cpp) ---------------------------
// Form1->Message->Lines->Add(text): one entry of the message area.
void host_message(const char *text, int length);
// Form1->Message->Lines->Clear()
void host_messages_clear(void);
// Application->MessageBox(text, title, MB_OK): a modal box with an OK button.
// The engine reports SIM_WAIT_ALERT until sim_alert_dismissed() is called.
void host_alert(const char *title, const char *text);
// scrshow(): the displayed registers, cycle count and listing highlight were
// refreshed; the host re-reads them through the exported getters.
void host_show_regs(void);
// Form1->setMenuActive() = MENU_ACTIVE, Form1->setMenuTrace() = MENU_TRACE.
enum { MENU_ACTIVE = 0, MENU_TRACE = 1 };
void host_menu_state(int state);
// Form1->SetFocus(): bring the main window forward.
void host_focus_main(void);
// Form1->AutoTraceTimer->Enabled changed.  While it is enabled the host calls
// sim_auto_trace_tick() at the auto-trace interval.
void host_autotrace_timer(int enabled);
// Form1->setMenuTask19() (enabled = 0) / restoreMenuTask19() (enabled = 1):
// TRAP #15 task 24 turned the simulator's shortcut keys off / on.
void host_key_commands(int enabled);
// Form1->ExceptionsEnabled->Checked / BitFieldEnabled->Checked changed by the
// program (task 32/5) or by a listing directive.
enum { OPTION_EXCEPTIONS = 0, OPTION_BITFIELD = 1 };
void host_option_changed(int option, int value);
// Form1->SaveSettings() (task 32/5).
void host_save_settings(void);
// Form1->Caption = name (program loaded).
void host_caption(const char *text, int length);
// Repaint requests: ListBox1->Repaint(), BreaksFrm->Repaint(),
// MemoryFrm->Repaint(), StackFrm->updateDisplay() / Repaint().
enum { REPAINT_LISTING = 1, REPAINT_BREAKPOINTS = 2, REPAINT_MEMORY = 4, REPAINT_STACK = 8 };
void host_repaint(int what);
// MemoryFrm->LivePaint(addr) after a successful mem_put.  Only called while
// the host has switched it on with sim_set_option(SIM_OPT_MEM_LIVE, 1).
void host_mem_live_paint(unsigned addr);
// TFont::Assign: "apply the font chosen in dialog <source> to surface
// <target>" (initSim, STARTSIM.CPP:46-51; initPrint, CODE9.CPP:79).
enum {
  FONT_TARGET_IO_BACKBUFFER = 1,
  FONT_TARGET_IO_WINDOW = 2,
  FONT_TARGET_LISTING = 3,
  FONT_TARGET_HEADINGS = 4,
  FONT_TARGET_MESSAGES = 5,
  FONT_TARGET_PRINTER = 6,
  FONT_SOURCE_IO_DIALOG = 101,
  FONT_SOURCE_LISTING_DIALOG = 102,
  FONT_SOURCE_PRINTER_DIALOG = 103
};
void host_font_assign(int target, int source);

// ---- hardware window (original: THardware, hardwareu.cpp) -------------------
// Hardware->update(): the 7-segment digits / LEDs / switch pictures may have
// changed; the host re-reads memory and sim_hw_get().
void host_hw_update(void);
// enable() / disable() / autoIRQon() / autoIRQoff(): the IRQ and Reset buttons
// are enabled iff hardwareEnabled; the label reads "Automatic Enabled" iff
// autoIRQ.
void host_hw_state(int hardwareEnabled, int autoIRQ);
// IRQ<level>timer->Enabled or ->Interval changed.  While a timer is enabled
// the host calls sim_hw_timer_tick(level) every intervalMs milliseconds
// (first tick one full interval after it was enabled; interval 0 never ticks).
void host_hw_timer(int level, int enabled, unsigned intervalMs);
// Hardware->Show() (TRAP #15 task 32/0).
void host_hw_show(void);
// A control of the hardware window was changed by the engine (memory-map
// check box or range from an S0 record, auto-IRQ check box, interval field).
void host_hw_controls(void);

// ---- log window (original: TLog, logU.cpp) ---------------------------------
// Bytes for the execution log file, exactly as the original writes them to
// disk (the file is opened in text mode, so line ends are CR LF).
void host_log_write(const char *data, int length);
// startLog() / stopLog(): logging is now on (1) / off (0); on "off" the host
// closes the log files.
void host_log_state(int logging);
// TLog::addMessage() for the OUTPUT log, which the host writes: the notes
// "***** Reset Program Pressed *****" / "***** Reload Program Pressed *****".
// The bytes go to the output log file as they are (it is a binary file).
void host_output_log_write(const char *data, int length);

// ---- clock (original: Borland gettime(), CODE9.CPP:776) ---------------------
// Local time of day in hundredths of a second since midnight (0..8639999).
unsigned host_time_centiseconds(void);

// ---- host files (original: fopen/fread/... in SIMOPS2.CPP) -------------------
// mode: FILE_OPEN_UPDATE = fopen(name,"r+b"), FILE_OPEN_READ = "rb",
// FILE_OPEN_CREATE = "w+b".  Returns a handle > 0, or 0 if the file cannot be
// opened that way.  name is the path exactly as the 68000 program gave it.
enum { FILE_OPEN_UPDATE = 0, FILE_OPEN_READ = 1, FILE_OPEN_CREATE = 2 };
int host_file_open(const char *name, int mode);
// Read up to n bytes at the file position; returns the number read (0 at end
// of file) or -1 on error.
int host_file_read(int handle, char *buffer, int n);
// Write n bytes at the file position; returns the number written or -1.
int host_file_write(int handle, const char *buffer, int n);
// whence: 0 = SEEK_SET, 1 = SEEK_CUR, 2 = SEEK_END.  Returns the new position
// or -1.
int host_file_seek(int handle, int offset, int whence);
// Returns 0 on success, -1 on error.
int host_file_close(int handle);
// remove(name).  Returns 0 on success, -1 on error.
int host_file_remove(const char *name);
// TRAP #15 task 58, TsimIO::displayFileDialog up to OpenDialogIO->Execute() /
// SaveDialogIO->Execute().  mode 0 = open dialog, 1 = save dialog.  The host
// answers later with sim_file_dialog_reply(); until then sim_run() returns
// SIM_WAIT_HOST.
void host_file_dialog(int mode, const char *title, const char *filter, const char *fileName);

// ---- I/O window, text (original: TsimIO, simIOu.cpp) ------------------------
void host_io_charOut(int ch);                        // charOut(ch)
void host_io_textOut(const char *text, int length);  // textOut(str)
void host_io_textOutCR(const char *text, int length);// textOutCR(str)
void host_io_clear(void);                            // clear()
void host_io_getrc(short *d1);                       // getrc(short*): (col << 8) | row
void host_io_gotorc(int row, int col);               // gotorc(r, c)
void host_io_setFontProperties(int color, int style);// setFontProperties(c, s)
void host_io_getCharAt(int row, int col, char *d1);  // getCharAt(r, c, char*)
void host_io_scrollRect(int row, int col, int height, int width, int direction); // scrollRect
void host_io_setWindowSize(int width, int height);   // setWindowSize(w, h)
void host_io_getWindowSize(unsigned short *width, unsigned short *height); // getWindowSize
void host_io_setupWindow(int fullScreen);            // fullScreen = ...; setupWindow()
void host_io_show(void);                             // simIO->Show()
void host_io_bringToFront(void);                     // if (simIO->Visible) simIO->BringToFront()
// prompt->Enabled: 0 = off, 1 = on, 2 = on and promptVisible = true (textIn).
void host_io_prompt(int mode);
void host_io_erasePrompt(void);                      // the drawing part of erasePrompt()
// FormKeyPress, ordinary character: if (echo) draw ch at the cursor and write
// it to the output log; then gotorc(row, col+1); Invalidate().
void host_io_inputEcho(int ch, int echo);
// FormKeyPress, backspace: gotorc(row, col-1); if (echo) draw " " there;
// Invalidate().
void host_io_inputBackspace(int echo);
void host_io_doCRLF(void);                           // doCRLF()
void host_io_invalidate(void);                       // this->Invalidate()

// ---- I/O window, graphics (TRAP #15 tasks 80-96) -----------------------------
void host_io_setLineColor(int color);
void host_io_setFillColor(int color);
void host_io_drawPixel(int x, int y);
int host_io_getPixel(int x, int y);
void host_io_line(int x1, int y1, int x2, int y2);
void host_io_lineTo(int x, int y);
void host_io_moveTo(int x, int y);
void host_io_rectangle(int x1, int y1, int x2, int y2);
void host_io_ellipse(int x1, int y1, int x2, int y2);
void host_io_floodFill(int x, int y);
void host_io_unfilledRectangle(int x1, int y1, int x2, int y2);
void host_io_unfilledEllipse(int x1, int y1, int x2, int y2);
void host_io_setDrawingMode(int mode);
void host_io_setPenWidth(int width);
void host_io_formPaint(void);                        // FormPaint (task 94)
void host_io_drawText(const char *text, int length, int x, int y);
void host_io_getXY(short *x, short *y);

// ---- I/O window, sound (TRAP #15 tasks 70-77) --------------------------------
void host_io_resetSounds(void);                      // ResetSounds() (initSim)
void host_io_playSound(const char *fileName, short *result);
void host_io_loadSound(const char *fileName, int waveIndex);
void host_io_playSoundMem(int waveIndex, short *result);
void host_io_controlSound(int control, int waveIndex, short *result);
void host_io_playSoundDX(const char *fileName, short *result);
void host_io_loadSoundDX(const char *fileName, int waveIndex, short *result);
void host_io_playSoundMemDX(int waveIndex, short *result);
void host_io_controlSoundDX(int control, int waveIndex, short *result);

// ---- I/O window, serial ports (TRAP #15 tasks 40-43) --------------------------
void host_io_initComm(int cid, const char *portName, short *result);
void host_io_setCommParams(int cid, int settings, short *result);
// The device part of readComm(): read up to n bytes into buffer.  Returns the
// number of bytes read (>= 0), or -1 = invalid port number, -3 = port not
// initialised, -2 = read error.  The engine does the rest of readComm (result
// code, memory-map check, copy to 68000 memory).
int host_io_commRead(int cid, char *buffer, int n);
// sendComm(cid, &n, str, &result): *n is the count on entry and the number
// sent on return.
void host_io_sendComm(int cid, unsigned char *n, const char *data, short *result);

// ---- I/O window, network (TRAP #15 tasks 100-107) -----------------------------
// The buffers are addresses inside 68000 memory; the host reads and writes
// them through the memory view.  Results are written as in the original.
void host_io_createNetClient(int settings, const char *server, int *result);
void host_io_createNetServer(int settings, int *result);
void host_io_sendNet(int settings, const char *data, const char *remoteIP, int *count, int *result);
void host_io_receiveNet(int settings, char *buffer, int *count, char *senderIP, int *result);
void host_io_sendPortNet(long *d0, long *d1, const char *data, const char *remoteIP);
void host_io_receivePortNet(long *d0, long *d1, char *buffer, char *senderIP);
void host_io_closeNetConnection(int closeIP, int *result);
void host_io_getLocalIP(char *localIP, int *result);
int host_net_closeSockets(void);                     // netCloseSockets() (initSim)

// ---- printer (TRAP #15 task 10; original: TPrinter) ---------------------------
void host_prn_beginDoc(void);
void host_prn_endDoc(void);
// which: 0 = Canvas->TextHeight("Xp"), 1 = Canvas->TextWidth("W"),
// 2 = PageHeight, 3 = PageWidth (all in printer pixels).
enum { PRN_ROW_HEIGHT = 0, PRN_COL_WIDTH = 1, PRN_PAGE_HEIGHT = 2, PRN_PAGE_WIDTH = 3 };
int host_prn_metric(int which);
void host_prn_textOut(int x, int y, int ch);

#ifdef __cplusplus
}
#endif

#endif
