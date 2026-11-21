// twin.h - functions shared by the simulator twin's driver (driver.cpp) and its file layer
// (hostfile-native.cpp). Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.
#ifndef EASY68K_TWIN_H
#define EASY68K_TWIN_H

#ifdef __cplusplus
extern "C" {
#endif

// Folder of the 68000 program's files, and folder for temporary files and the execution log.
void twin_files_init(const char *sandbox, const char *work);
// 1 if name may be opened by a program: 1-64 characters A-Z a-z 0-9 . _ -, not starting with '.'.
int twin_plain_name(const char *name);
// Path of the execution-log file (flushed first).
const char *twin_log_path(void);

#ifdef __cplusplus
}
#endif

#endif
