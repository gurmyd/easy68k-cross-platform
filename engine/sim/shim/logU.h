// easy68k-mac: stand-in for the original logU.h (the "Log Output" dialog,
// class TLog).  File names and the Replace / Append / Cancel question belong
// to the host; the engine keeps the logging flag, writes the execution-log
// text and hands the bytes to the host (host_log_write).
// Implemented in shim/log.cpp.
#ifndef EASY68K_LOGU_H
#define EASY68K_LOGU_H

#include "vcl.h"

class TLog {
public:
  void stopLog();                  // logU.cpp:202
  void stopLogWithAnnounce();      // logU.cpp:217
  // logU.cpp:227 and the execution-log part of prepareLogFile (logU.cpp:103).
  // timeStr is DateTimeToStr(Now()) as the host formats it.
  void startLog(const char *timeStr);
  void addMessage(const AnsiString &msg); // logU.cpp:289
  void setLogFileNames();          // logU.cpp:59 (the part that stops a running log)
};

extern TLog *Log;

// logU.cpp:33: the log types as they were when the Log Output dialog was last
// opened (TLog::FormShow).  addMessage() tests these, not ElogFlag / OlogFlag.
extern int eLogType, oLogType;

#endif
