// easy68k-mac: log.cpp - the engine side of the Log Output window (TLog,
// logU.cpp).  File names, the Replace / Append / Cancel question and the
// output (text) log file itself belong to the host.
#include "extern.h"
#include "SIM68Ku.h"
#include "logU.h"
#include "host.h"
#include "runloop.h"
#include "api.h"

static TLog theLog;
TLog *Log = &theLog;

// logU.cpp:33
int eLogType = 0, oLogType = 0;

// The "Memory Range to Log" fields of the dialog (MemFrom, MemBytes), as
// numbers; set with sim_set_option(SIM_OPT_LOG_MEM_FROM / _BYTES).
unsigned int easy68k_log_mem_from = 0;
unsigned int easy68k_log_mem_bytes = 0;

// logU.cpp:202
void TLog::stopLog() {
  if (logging) { // if log in progress
    // fclose(ElogFile); fclose(OlogFile);  -> the host closes its files
    easy68k_log_open(false);
    easy68k_files_log_streams(0);
    logging = false;
    host_log_state(0);
  }
}

// logU.cpp:217
void TLog::stopLogWithAnnounce() {
  if (logging) {
    Application->MessageBox("Current Log Stopped.", "Information", MB_OK);
    stopLog();
  }
}

// logU.cpp:227 startLog() with the engine's share of prepareLogFile()
// (logU.cpp:103-199): the header line and the memory range.
void TLog::startLog(const char *timeStr) {
  if (ElogFlag) { // if execution log selected
    easy68k_log_open(true);
    // label file
    fprintf(ElogFile, "EASy68K execution log file: %s\n\n", timeStr);
    fflush(ElogFile);
    if (ElogFlag == INST_REG_MEM) { // if logging memory
      logMemAddr = easy68k_log_mem_from; // get address to log
      logMemAddr -= logMemAddr % 16;     // force to $10 boundary
      logMemBytes = easy68k_log_mem_bytes; // get byte count
      logMemBytes += 15;
      logMemBytes -= logMemBytes % 16;   // force to increment of $10
    }
  }
  // prepareLogFile opens a stream for each selected log (logU.cpp:111-176)
  easy68k_files_log_streams((ElogFlag ? 1 : 0) + (OlogFlag ? 1 : 0));
  logging = true;
  host_log_state(1);
}

// logU.cpp:289.  Note the quirk: the tests use eLogType / oLogType, the log
// types as they were when the Log Output dialog was last opened.
void TLog::addMessage(const AnsiString &msg) {
  if (logging && eLogType) {
    fputs(msg.c_str(), ElogFile);
    fflush(ElogFile);
  }
  if (logging && oLogType) host_output_log_write(msg.c_str(), msg.Length());
}

// logU.cpp:59-66: opening a program stops a running log.
void TLog::setLogFileNames() {
  if (logging) {
    stopLog(); // stop current log
    Application->MessageBox("Current Log Stopped.", "Information", MB_OK);
  }
}
