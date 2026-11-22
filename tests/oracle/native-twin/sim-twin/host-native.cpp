// host-native.cpp - what the simulator twin gives the engine's shim natively, so that the engine's
// own shim/hostfile.cpp (the streams of the Borland run-time, engine/sim/shim/STDIO-MODEL.md) runs
// unchanged on top, exactly as it runs in WebAssembly:
//
//   1. The host's file interface (host_file_open ... host_file_remove, engine/sim/shim/host.h):
//      the 68000 program's files are real files of the sandbox folder, with the rules of the
//      Sandbox class of sim-script.mjs, which serves the same calls to the WebAssembly build: plain
//      names only (twin_plain_name), one stream per file, a create truncates, "rb" refuses writes,
//      every call reaches the file at once (no buffer of its own).
//   2. fopencookie(), which the Microsoft C library does not have and hostfile.cpp uses for the
//      S-record text of loadSrec ("rt", a read cookie) and for the execution log (a write cookie):
//      a read cookie is read to its end into a temporary file, which is then opened as a real FILE;
//      a write cookie is a real temporary FILE whose bytes are handed to the cookie's write function
//      at every fflush() (native-prelude.h maps fflush here). The engine flushes the execution log
//      after every record and before a log opens or closes, so the cookie sees the same bytes in
//      the same order as on the WebAssembly side.
//   3. host_log_write(): the bytes of the execution log, which `dump log` shows.
//
// Part of easy68k-cross-platform, an unofficial port of EASy68K. GPL-2.0-or-later.
#include "extern.h"
#include "host.h"
#include "twin.h"

#include <io.h>
#include <cctype>
#include <cstring>
#include <map>
#include <string>
#include <vector>

// This file uses the C library itself: none of the engine's renamings.
#undef fopen
#undef fclose
#undef fread
#undef fwrite
#undef fseek
#undef feof
#undef fflush
#undef remove

static std::string sandboxDir, workDir;
static int tempCounter = 0;
static std::vector<unsigned char> logBytes;

static std::string joinPath(const std::string &dir, const char *name) {
  std::string path = dir;
  if (!path.empty() && path[path.size() - 1] != '\\' && path[path.size() - 1] != '/') path += '\\';
  return path + name;
}

static std::string lowerName(const char *name) {
  std::string key(name);
  for (char &c : key) c = (char)tolower((unsigned char)c);
  return key;
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

extern "C" const unsigned char *twin_log_data(int *length) {
  *length = (int)logBytes.size();
  return logBytes.empty() ? (const unsigned char *)"" : &logBytes[0];
}

// ---------------------------------------------------------------------------
// 1. The host's file interface.
// ---------------------------------------------------------------------------
struct NativeHandle {
  FILE *file;
  std::string key; // lower-case name
  bool readOnly;
};
static std::map<int, NativeHandle> handles;
static int nextHandle = 1;

static bool isOpen(const std::string &key) {
  for (const auto &entry : handles)
    if (entry.second.key == key) return true;
  return false;
}

int host_file_open(const char *name, int mode) {
  if (!twin_plain_name(name)) return 0;
  const std::string key = lowerName(name);
  if (isOpen(key)) return 0;
  const char *how = mode == FILE_OPEN_CREATE ? "w+b" : mode == FILE_OPEN_READ ? "rb" : mode == FILE_OPEN_UPDATE ? "r+b" : NULL;
  if (!how) return 0;
  FILE *file = fopen(joinPath(sandboxDir, name).c_str(), how);
  if (!file) return 0;
  setvbuf(file, NULL, _IONBF, 0);
  const int handle = nextHandle++;
  handles[handle] = NativeHandle{file, key, mode == FILE_OPEN_READ};
  return handle;
}

int host_file_read(int handle, char *buffer, int n) {
  auto it = handles.find(handle);
  if (it == handles.end() || n < 0) return -1;
  FILE *file = it->second.file;
  if (fseek(file, 0, SEEK_CUR) != 0) return -1; // C asks for a seek between a write and a read
  size_t got = fread(buffer, 1, (size_t)n, file);
  if (ferror(file)) {
    clearerr(file);
    return -1;
  }
  clearerr(file); // the end-of-file indicator must not stop a later read after a write elsewhere
  return (int)got;
}

int host_file_write(int handle, const char *buffer, int n) {
  auto it = handles.find(handle);
  if (it == handles.end() || it->second.readOnly || n < 0) return -1;
  FILE *file = it->second.file;
  if (fseek(file, 0, SEEK_CUR) != 0) return -1;
  size_t put = n > 0 ? fwrite(buffer, 1, (size_t)n, file) : 0;
  if (put != (size_t)n) {
    clearerr(file);
    return -1;
  }
  return n;
}

int host_file_seek(int handle, int offset, int whence) {
  auto it = handles.find(handle);
  if (it == handles.end() || whence < 0 || whence > 2) return -1;
  FILE *file = it->second.file;
  long base;
  if (whence == SEEK_SET) base = 0;
  else if (whence == SEEK_CUR) base = ftell(file);
  else {
    if (fseek(file, 0, SEEK_END) != 0) return -1;
    base = ftell(file);
  }
  long long position = (long long)base + offset;
  if (base < 0 || position < 0 || position > 0x7FFFFFFF) return -1;
  if (fseek(file, (long)position, SEEK_SET) != 0) return -1;
  return (int)position;
}

int host_file_close(int handle) {
  auto it = handles.find(handle);
  if (it == handles.end()) return -1;
  int r = fclose(it->second.file);
  handles.erase(it);
  return r == 0 ? 0 : -1;
}

int host_file_remove(const char *name) {
  if (!twin_plain_name(name)) return -1;
  if (isOpen(lowerName(name))) return -1;
  return remove(joinPath(sandboxDir, name).c_str()) == 0 ? 0 : -1;
}

// ---------------------------------------------------------------------------
// 2. fopencookie() and the fflush() that serves write cookies.
// ---------------------------------------------------------------------------
struct WriteCookie {
  void *cookie;
  cookie_io_functions_t io;
};
static std::map<FILE *, WriteCookie> writeCookies;

static FILE *tempFile(const char *mode) {
  char name[64];
  sprintf(name, "cookie-%d.tmp", ++tempCounter);
  return fopen(joinPath(workDir, name).c_str(), mode);
}

extern "C" FILE *twin_fopencookie(void *cookie, const char *mode, cookie_io_functions_t io) {
  if (mode[0] == 'r') {
    // A read cookie: everything it has, then a real file with those bytes ("D": deleted on close).
    std::vector<char> data;
    char buffer[4096];
    for (;;) {
      ssize_t n = io.read ? io.read(cookie, buffer, sizeof buffer) : 0;
      if (n <= 0) break;
      data.insert(data.end(), buffer, buffer + n);
    }
    if (io.close) io.close(cookie);
    char name[64];
    sprintf(name, "cookie-%d.tmp", ++tempCounter);
    const std::string path = joinPath(workDir, name);
    FILE *out = fopen(path.c_str(), "wb");
    if (!out) return NULL;
    if (!data.empty()) fwrite(&data[0], 1, data.size(), out);
    fclose(out);
    return fopen(path.c_str(), "rbD");
  }
  // A write cookie: a temporary file in binary mode, emptied into the cookie at every fflush().
  FILE *file = tempFile("w+bD");
  if (!file) return NULL;
  writeCookies[file] = WriteCookie{cookie, io};
  return file;
}

extern "C" int twin_fflush(FILE *stream) {
  int r = fflush(stream);
  auto it = writeCookies.find(stream);
  if (it == writeCookies.end()) return r;
  long size = ftell(stream);
  if (size > 0) {
    std::vector<char> data((size_t)size);
    fseek(stream, 0, SEEK_SET);
    size_t got = fread(&data[0], 1, data.size(), stream);
    if (it->second.io.write) it->second.io.write(it->second.cookie, &data[0], got);
    fseek(stream, 0, SEEK_SET);
    _chsize(_fileno(stream), 0);
  }
  return r;
}

// ---------------------------------------------------------------------------
// 3. The execution log's bytes, as the engine hands them to the host.
// ---------------------------------------------------------------------------
void host_log_write(const char *data, int length) {
  if (data && length > 0) logBytes.insert(logBytes.end(), data, data + length);
}
