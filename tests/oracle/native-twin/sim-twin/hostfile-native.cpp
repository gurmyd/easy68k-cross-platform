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
//
// Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.
#include "extern.h"
#include "runloop.h"
#include "twin.h"

#undef fopen
#undef remove

static std::string sandboxDir, workDir;
static FILE *realLog = NULL, *nullLog = NULL;
static int tempCounter = 0;

static std::string joinPath(const std::string &dir, const char *name) {
  std::string path = dir;
  if (!path.empty() && path[path.size() - 1] != '\\' && path[path.size() - 1] != '/') path += '\\';
  return path + name;
}

extern "C" int twin_plain_name(const char *name) {
  size_t n = strlen(name);
  if (n == 0 || n > 64 || name[0] == '.') return 0;
  for (size_t i = 0; i < n; i++) {
    unsigned char c = (unsigned char)name[i];
    if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-')) return 0;
  }
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
  FILE *stream = fopen(joinPath(sandboxDir, name).c_str(), mode);
  if (stream) setvbuf(stream, NULL, _IONBF, 0);
  return stream;
}

extern "C" int easy68k_remove(const char *name) {
  if (!twin_plain_name(name)) return -1;
  return remove(joinPath(sandboxDir, name).c_str()) == 0 ? 0 : -1;
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
