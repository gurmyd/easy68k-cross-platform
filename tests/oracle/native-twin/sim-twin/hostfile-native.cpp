// hostfile-native.cpp - the simulator twin's replacement for engine/sim/shim/hostfile.cpp.
//
// The engine's hostfile.cpp builds FILE streams with fopencookie(), which the Microsoft C library
// does not have. This file keeps its three jobs and its behaviour, with real files instead:
//
//   1. Files of the 68000 program (TRAP #15 tasks 50-59): fopen(name, "r+b" / "rb" / "w+b") on a
//      file of the sandbox folder, unbuffered, as the engine's streams are. A name is accepted only
//      if it is a plain file name (twin_plain_name); anything else cannot be opened, exactly as in
//      the JavaScript runner (sim-script.mjs), so that both sides see the same files.
//   2. The S-record text being loaded (fopen(name, "rt") in loadSrec): the staged bytes are
//      translated as the Borland C library reads text mode - carriage returns removed, Ctrl-Z ends
//      the file - written to a temporary file and opened in binary mode ("D": deleted on close).
//   3. The execution log: a real file opened in text mode, so "\n" becomes CR LF on disk as in the
//      engine; while no log is open, ElogFile points at the null device instead, which is what the
//      engine's stream does (it drops the bytes).
//   4. fread() and fwrite() of TRAP #15 tasks 53 and 54 (easy68k_fread, easy68k_fwrite), with the
//      engine's two Borland rules.
//
// Part of easy68k-cross-platform, an unofficial port of EASy68K. GPL-2.0-or-later.
#include "extern.h"
#include "runloop.h"
#include "twin.h"

#include <cctype>
#include <climits>
#include <cstring>
#include <map>
#include <string>

#undef fclose
#undef fopen
#undef remove
#undef fread
#undef fwrite

static std::string sandboxDir, workDir;
static FILE *realLog = NULL, *nullLog = NULL;
static int tempCounter = 0;
// The program files that are open, by stream, with their names in lower case.
static std::map<FILE *, std::string> openProgramFiles;

static std::string lowerName(const char *name) {
  std::string key(name);
  for (char &c : key) c = (char)tolower((unsigned char)c);
  return key;
}

static std::string joinPath(const std::string &dir, const char *name) {
  std::string path = dir;
  if (!path.empty() && path[path.size() - 1] != '\\' && path[path.size() - 1] != '/') path += '\\';
  return path + name;
}

// The rule of isPlainName() in sim-script.mjs: 1-64 characters A-Z a-z 0-9 . _ -, not starting or
// ending with '.', and not a Windows device name (CON, PRN, AUX, NUL, COM0-9, LPT0-9, with or
// without an extension). Windows drops a trailing dot and opens a device for such a name, which the
// in-memory files of the WebAssembly side cannot do, so both sides refuse them.
extern "C" int twin_plain_name(const char *name) {
  size_t n = strlen(name);
  if (n == 0 || n > 64 || name[0] == '.' || name[n - 1] == '.') return 0;
  for (size_t i = 0; i < n; i++) {
    unsigned char c = (unsigned char)name[i];
    if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-')) return 0;
  }
  size_t base = 0;
  char upper[5] = {0};
  while (base < n && name[base] != '.') {
    if (base < 4) upper[base] = (char)toupper((unsigned char)name[base]);
    base++;
  }
  if (base == 3 && (!strcmp(upper, "CON") || !strcmp(upper, "PRN") || !strcmp(upper, "AUX") || !strcmp(upper, "NUL"))) return 0;
  if (base == 4 && (!strncmp(upper, "COM", 3) || !strncmp(upper, "LPT", 3)) && upper[3] >= '0' && upper[3] <= '9') return 0;
  return 1;
}

extern "C" void twin_files_init(const char *sandbox, const char *work) {
  sandboxDir = sandbox;
  workDir = work;
}

extern "C" const char *twin_log_path(void) {
  static std::string path;
  path = joinPath(workDir, "execution-log.txt");
  if (realLog) fflush(realLog);
  return path.c_str();
}

// ---------------------------------------------------------------------------
// 2. The S-record file being loaded.
// ---------------------------------------------------------------------------
static std::vector<unsigned char> stagedSrecord;
static bool stagedSrecordPresent = false;

void easy68k_stage_srecord(const unsigned char *data, int length) {
  stagedSrecordPresent = (data != NULL);
  stagedSrecord.clear();
  if (data && length > 0) stagedSrecord.assign(data, data + length);
}

extern "C" FILE *easy68k_fopen(const char *name, const char *mode) {
  if (strcmp(mode, "rt") == 0) { // loadSrec()
    if (!stagedSrecordPresent) return NULL;
    std::string text;
    for (size_t i = 0; i < stagedSrecord.size(); i++) {
      unsigned char c = stagedSrecord[i];
      if (c == 0x1A) break;     // Ctrl-Z: end of file in text mode
      if (c == '\r') continue;  // text mode drops carriage returns
      text.push_back((char)c);
    }
    char tempName[64];
    sprintf(tempName, "srecord-%d.tmp", ++tempCounter);
    std::string path = joinPath(workDir, tempName);
    FILE *out = fopen(path.c_str(), "wb");
    if (!out) return NULL;
    if (!text.empty()) fwrite(text.data(), 1, text.size(), out);
    fclose(out);
    return fopen(path.c_str(), "rbD");
  }

  // 1. Files of the 68000 program.
  if (strcmp(mode, "r+b") != 0 && strcmp(mode, "rb") != 0 && strcmp(mode, "w+b") != 0) return NULL;
  if (!twin_plain_name(name)) return NULL;
  // A file is open in at most one stream and cannot be removed while it is open, as in the Sandbox
  // of sim-script.mjs: what Windows does with two streams on one file has no counterpart there.
  const std::string key = lowerName(name);
  for (const auto &entry : openProgramFiles)
    if (entry.second == key) return NULL;
  FILE *stream = fopen(joinPath(sandboxDir, name).c_str(), mode);
  if (stream) {
    setvbuf(stream, NULL, _IONBF, 0);
    openProgramFiles[stream] = key;
  }
  return stream;
}

extern "C" int easy68k_remove(const char *name) {
  if (!twin_plain_name(name)) return -1;
  const std::string key = lowerName(name);
  for (const auto &entry : openProgramFiles)
    if (entry.second == key) return -1;
  return remove(joinPath(sandboxDir, name).c_str()) == 0 ? 0 : -1;
}

// Every fclose() of the engine comes here (native-prelude.h), so that a closed program file may be
// opened and removed again.
extern "C" int twin_fclose(FILE *stream) {
  openProgramFiles.erase(stream);
  return fclose(stream);
}

// fread() and fwrite() of SIMOPS2.CPP (TRAP #15 tasks 53 and 54), as the engine's hostfile.cpp
// answers them since gate I2: the two requests where the Borland run-time library linked into
// SIM68K.exe differs from a C99 library (engine/sim/PATCHES.md section 3), everything else to the
// C library. The same rules as the engine's, so that a difference between the twin and the
// WebAssembly build still points at the compiler and not at this file.
extern "C" size_t easy68k_fread(void *buffer, size_t size, size_t count, FILE *stream) {
  if (size == 1 && count > (size_t)INT_MAX) return count; // task 53 whose bounds test wraps
  return fread(buffer, size, count, stream);
}

extern "C" size_t easy68k_fwrite(const void *buffer, size_t size, size_t count, FILE *stream) {
  if (size == 0) return count; // task 54 with D2 = 0 succeeds
  return fwrite(buffer, size, count, stream);
}

// ---------------------------------------------------------------------------
// 3. The execution log.
// ---------------------------------------------------------------------------
void easy68k_log_init() {
  realLog = fopen(joinPath(workDir, "execution-log.txt").c_str(), "w"); // text mode: "\n" -> CR LF
  nullLog = fopen("NUL", "w");
  ElogFile = nullLog;
  OlogFile = NULL; // the output log belongs to the host, as in the engine
}

void easy68k_log_open(bool open) {
  if (ElogFile) fflush(ElogFile);
  ElogFile = open ? realLog : nullLog;
}
