// easy68k-mac: hostfile.cpp - the C-library FILE streams of the original,
// connected to the host instead of to a disk.
//
// The original uses <stdio.h> files in three places:
//   1. SIMOPS2.CPP, TRAP #15 tasks 50-59: fopen(name, "r+b" / "rb" / "w+b"),
//      fread, fwrite, fseek, fclose, feof, remove.
//   2. SIMOPS2.CPP, loadSrec(): fopen(name, "rt") and fgets.
//   3. RUN.CPP and the log window: fprintf(ElogFile, ...) for the execution log.
// prelude.h renames fopen() and remove() to the two functions below.  They
// return ordinary FILE pointers made with fopencookie(), so every other stdio
// call in the original source works unchanged, and no file system is compiled
// into the engine.
#include "extern.h"
#include "host.h"
#include "runloop.h"

// ---------------------------------------------------------------------------
// 1. Files of the 68000 program: every operation goes straight to the host.
// The streams are unbuffered, so the host always sees reads, writes and
// seeks in program order.  (The original C library buffers; a 68000 program
// cannot tell the difference except that data reaches the file sooner.)
// ---------------------------------------------------------------------------
struct HostFile {
  int handle;
};

static ssize_t hostFileRead(void *cookie, char *buffer, size_t size) {
  int n = host_file_read(((HostFile *)cookie)->handle, buffer, (int)size);
  return n < 0 ? -1 : n;
}
static ssize_t hostFileWrite(void *cookie, const char *buffer, size_t size) {
  int n = host_file_write(((HostFile *)cookie)->handle, buffer, (int)size);
  return n < 0 ? 0 : n; // a cookie write function reports an error as 0
}
static int hostFileSeek(void *cookie, off_t *offset, int whence) {
  int position = host_file_seek(((HostFile *)cookie)->handle, (int)*offset, whence);
  if (position < 0) return -1;
  *offset = position;
  return 0;
}
static int hostFileClose(void *cookie) {
  HostFile *file = (HostFile *)cookie;
  int result = host_file_close(file->handle);
  delete file;
  return result == 0 ? 0 : EOF;
}

// ---------------------------------------------------------------------------
// 2. The S-record file being loaded.  The host stages its bytes; they are
// read here as the Borland C library reads a file opened in text mode ("rt"):
// carriage returns are removed and Ctrl-Z (0x1A) ends the file.
// ---------------------------------------------------------------------------
static std::vector<unsigned char> stagedSrecord;
static bool stagedSrecordPresent = false;

void easy68k_stage_srecord(const unsigned char *data, int length) {
  stagedSrecordPresent = (data != NULL);
  stagedSrecord.clear();
  if (data && length > 0) stagedSrecord.assign(data, data + length);
}

struct SrecordStream {
  size_t position;
};
static ssize_t srecordRead(void *cookie, char *buffer, size_t size) {
  SrecordStream *stream = (SrecordStream *)cookie;
  size_t count = 0;
  while (count < size && stream->position < stagedSrecord.size()) {
    unsigned char c = stagedSrecord[stream->position];
    if (c == 0x1A) { // Ctrl-Z: end of file in text mode
      stream->position = stagedSrecord.size();
      break;
    }
    stream->position++;
    if (c == '\r') continue; // text mode drops carriage returns
    buffer[count++] = (char)c;
  }
  return (ssize_t)count;
}
static int srecordClose(void *cookie) {
  delete (SrecordStream *)cookie;
  return 0;
}

extern "C" FILE *easy68k_fopen(const char *name, const char *mode) {
  if (strcmp(mode, "rt") == 0) { // loadSrec()
    if (!stagedSrecordPresent) return NULL;
    cookie_io_functions_t io = {srecordRead, NULL, NULL, srecordClose};
    SrecordStream *stream = new SrecordStream();
    stream->position = 0;
    return fopencookie(stream, "r", io);
  }

  int hostMode;
  const char *streamMode;
  if (strcmp(mode, "r+b") == 0) {
    hostMode = FILE_OPEN_UPDATE;
    streamMode = "r+";
  } else if (strcmp(mode, "rb") == 0) {
    hostMode = FILE_OPEN_READ;
    streamMode = "r";
  } else if (strcmp(mode, "w+b") == 0) {
    hostMode = FILE_OPEN_CREATE; // the host creates or truncates the file
    streamMode = "r+";
  } else {
    return NULL; // no other mode is used by the original
  }
  int handle = host_file_open(name, hostMode);
  if (handle <= 0) return NULL;
  cookie_io_functions_t io = {hostFileRead, hostFileWrite, hostFileSeek, hostFileClose};
  HostFile *file = new HostFile();
  file->handle = handle;
  FILE *stream = fopencookie(file, streamMode, io);
  if (!stream) {
    host_file_close(handle);
    delete file;
    return NULL;
  }
  setvbuf(stream, NULL, _IONBF, 0);
  return stream;
}

extern "C" int easy68k_remove(const char *name) { return host_file_remove(name) == 0 ? 0 : -1; }

// ---------------------------------------------------------------------------
// 3. The execution log.  The original opens it in text mode ("wt" / "at"), so
// every "\n" the simulator prints is written to disk as CR LF.  The same
// translation is done here, and the resulting bytes are handed to the host.
// ---------------------------------------------------------------------------
static bool logOpen = false;

static ssize_t logWrite(void *, const char *buffer, size_t size) {
  if (logOpen && size > 0) {
    std::string out;
    out.reserve(size + 16);
    for (size_t i = 0; i < size; i++) {
      if (buffer[i] == '\n') out.push_back('\r');
      out.push_back(buffer[i]);
    }
    host_log_write(out.data(), (int)out.size());
  }
  return (ssize_t)size;
}

void easy68k_log_init() {
  cookie_io_functions_t io = {NULL, logWrite, NULL, NULL};
  ElogFile = fopencookie(NULL, "w", io);
  // OlogFile (the output log) is written by the I/O window, which belongs to
  // the host; the engine never uses it.
  OlogFile = NULL;
}

void easy68k_log_open(bool open) {
  if (ElogFile) fflush(ElogFile);
  logOpen = open;
}
