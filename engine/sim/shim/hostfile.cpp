// easy68k-mac: hostfile.cpp - the C-library FILE streams of the original,
// connected to the host instead of to a disk.
//
// The original uses <stdio.h> files in three places:
//   1. SIMOPS2.CPP, TRAP #15 tasks 50-59: fopen(name, "r+b" / "rb" / "w+b"),
//      fread, fwrite, fseek, fclose, feof, remove.
//   2. SIMOPS2.CPP, loadSrec(): fopen(name, "rt") and fgets.
//   3. RUN.CPP and the log window: fprintf(ElogFile, ...) for the execution log.
// prelude.h renames fopen(), remove(), fread(), fwrite(), fseek(), fclose()
// and feof() to the functions below.  The files of (1) are streams of the
// Borland C run-time library modelled here (section 1); the streams of (2)
// and (3) are ordinary FILE pointers made with fopencookie() and served by
// the C library of this build.  No file system is compiled into the engine.
#include "extern.h"
#include "host.h"
#include "runloop.h"
#include "vcl.h"

// ===========================================================================
// 1. Files of the 68000 program: the stream of the Borland C++ Builder 6
// run-time library that is linked into SIM68K.exe, over the host's files.
//
// engine/sim/shim/STDIO-MODEL.md is the specification: it states every rule
// below, where it was read in SIM68K.exe and which probe program measured it
// in the official simulator.  In short: a stream has a 512-byte buffer, a
// position in it (curp) and ONE signed counter (level) for both directions:
// positive = bytes left to read in the buffer, negative = -(free bytes + 1)
// while writing.  fread() and fwrite() test that counter, not a "last
// operation" flag, so a read straight after a write (or a write straight
// after a read) without a seek works on the buffer in the other direction -
// which C leaves undefined and which this run-time answers as follows.
//
// The host is used as the operating system below the run-time (ReadFile,
// WriteFile, SetFilePointer, CloseHandle): every read and write reaches the
// file at once.  Only the bytes that the stream would write when it is
// flushed are left with the host as pending bytes of the stream (they are
// "mirrored"), so that the host writes them at the end of the process as the
// run-time's exit code does - for a stream that is never closed, also one a
// simulator reset forgot.
// ===========================================================================
namespace {

// FILE.flags of the Borland run-time (_F_READ ... _F_TERM).
enum : unsigned short {
  BF_READ = 0x0001, // opened for reading
  BF_WRIT = 0x0002, // opened for writing
  BF_BUF = 0x0004,  // the buffer was allocated by the run-time
  BF_LBUF = 0x0008, // line buffered (terminals only)
  BF_ERR = 0x0010,  // error indicator (ferror)
  BF_EOF = 0x0020,  // end-of-file indicator (feof)
  BF_BIN = 0x0040,  // binary mode
  BF_IN = 0x0080,   // data is incoming
  BF_OUT = 0x0100,  // data is outgoing (never set by fwrite)
  BF_TERM = 0x0200, // the handle is a terminal
};

const int BUFFER_SIZE = 512; // setvbuf(fp, NULL, _IOFBF, 512) in fopen
// _streams[] has 50 entries (_NFILE_); stdin, stdout and stderr hold three.
const int STREAM_SLOTS = 47;

// The 512-byte heap block that holds a stream buffer.  The run-time frees it
// at fclose and the next fopen gets it back (STDIO-MODEL.md, "The buffer's
// memory"); its old bytes stay in it.  A read past its end returns
// BEYOND_BYTE; a write past its end is kept with the block (in the original it
// overwrites whatever follows in the heap).
const unsigned char FRESH_BYTE = 0x00;
const unsigned char BEYOND_BYTE = 0x00;
struct Block {
  std::vector<unsigned char> bytes; // at least BUFFER_SIZE
};
std::vector<Block *> freeBlocks; // freed blocks, the next one to be reused last

Block *allocBlock() {
  if (!freeBlocks.empty()) {
    Block *block = freeBlocks.back();
    freeBlocks.pop_back();
    return block;
  }
  Block *block = new Block();
  block->bytes.assign(BUFFER_SIZE, FRESH_BYTE);
  return block;
}
void freeBlock(Block *block) {
  block->bytes.resize(BUFFER_SIZE); // what lay past the end is not part of the block
  freeBlocks.push_back(block);
}

struct Stream {
  // ---- the FILE structure of the run-time
  bool open;           // fd >= 0
  unsigned short flags;
  int level;           // see above
  int bsize;           // 512
  long long curp;      // offset of curp from the start of the buffer
  Block *buffer;
  int handle;          // the host handle (the run-time's file handle)
  // ---- the port's bookkeeping
  long long osPosition; // the position of the handle in the operating system's sense
  int mirrored;         // pending bytes the host holds: buffer[0, mirrored) at osPosition
  unsigned char mirror[BUFFER_SIZE];
  bool mirrorLost;      // the host refused them; a flush writes them itself
  std::string name;     // for the repair of the mirror (mirrorRepair)
  unsigned nameEpoch;
};
Stream streams[STREAM_SLOTS];
unsigned nameEpoch = 0; // counts the task 58 dialogs that moved the current folder

bool isStream(FILE *fp) {
  Stream *s = (Stream *)fp;
  return s >= &streams[0] && s < &streams[STREAM_SLOTS];
}

unsigned char byteAt(Stream *s, long long offset) {
  if (offset < 0 || offset >= (long long)s->buffer->bytes.size()) return BEYOND_BYTE;
  return s->buffer->bytes[(size_t)offset];
}
void putByte(Stream *s, long long offset, unsigned char value) {
  if (offset < 0) return;
  std::vector<unsigned char> &bytes = s->buffer->bytes;
  // Bytes written past the end of the block are kept (up to 1 MB) so that a
  // later read through the same stream returns them, as it does in the
  // original as long as nothing else used that heap memory.
  if (offset >= (long long)bytes.size()) {
    if (offset >= BUFFER_SIZE + (1 << 20)) return;
    bytes.resize((size_t)offset + 1, BEYOND_BYTE);
  }
  bytes[(size_t)offset] = value;
}

// The 68000 memory that a task passes as a buffer ends with the padding of
// api.cpp; a copy that would run past it is the original's access violation.
void checkTarget(const void *target, unsigned long long count) {
  uintptr_t at = (uintptr_t)target, base = (uintptr_t)memory;
  uintptr_t end = base + MEMSIZE + EASY68K_MEMORY_PADDING;
  if (at < base || at > end || count > end - at) throw EAccessViolation();
}
void copyFromBuffer(Stream *s, char *target, unsigned count) {
  checkTarget(target, count);
  for (unsigned i = 0; i < count; i++) target[i] = (char)byteAt(s, s->curp + i);
}
void copyToBuffer(Stream *s, const char *source, unsigned count) {
  for (unsigned i = 0; i < count; i++) putByte(s, s->curp + i, (unsigned char)source[i]);
}

// ---- the operating system: the host's file calls without its buffering ----
// The host (app/src/core/sim-host/files) buffers on its own: it holds up to
// 512 written bytes of a handle as pending until the next seek, read, close,
// or a write that does not fit, and it keeps the last 512-byte block it read.
// Neither is seen here: the stream's reads move forward from where the last
// one ended (so the host's read block never holds them), and the only bytes
// left pending are the mirror (below), which the host writes at the next call
// on the handle - inside the same task, where the original's WriteFile ran.
// A write that the host would keep pending is followed by a seek that makes
// it write them at once.

// __read(fd, buf, n), binary mode (ReadFile).
int osRead(Stream *s, char *target, unsigned n) {
  if (n + 1 < 2) return 0; // n == 0 or n == (unsigned)-1: no call
  if (n > (unsigned)INT_MAX) return -1; // ReadFile refuses a buffer that size
  int r = host_file_read(s->handle, target, (int)n);
  if (r < 0) return -1;
  s->osPosition += r;
  return r;
}

// __write(fd, buf, n), binary mode (WriteFile).
int osWrite(Stream *s, const char *source, unsigned n) {
  if (n + 1 < 2) return 0; // n == 0 or n == (unsigned)-1: no call
  if (n > (unsigned)INT_MAX) return -1; // WriteFile refuses a buffer that size
  int r = host_file_write(s->handle, source, (int)n);
  if (r < 0) return -1;
  if (n <= (unsigned)BUFFER_SIZE && host_file_seek(s->handle, 0, SEEK_CUR) < 0) return -1;
  s->osPosition += r;
  return r;
}

// lseek(fd, offset, whence) (SetFilePointer).
long long osSeek(Stream *s, int offset, int whence) {
  int r = host_file_seek(s->handle, offset, whence);
  if (r < 0) return -1;
  s->osPosition = r;
  return r;
}

// ---- the mirror of the bytes a flush would write ----
int flushCount(Stream *s) {
  if (s->level >= 0) return 0;
  int n = s->bsize + s->level + 1;
  return n > 0 ? n : 0;
}

// The host's pending bytes do not begin the bytes a flush would write (a read
// in the write state made fewer of them due): write the pending bytes, then
// put back what the file held before (read through a second handle, which
// does not see the pending bytes), truncating it with a create if needed.
// Only then are the right bytes mirrored.  If the file cannot be found again
// by its name (the current folder moved), the stale bytes stay.
void mirrorRepair(Stream *s) {
  if (s->nameEpoch != nameEpoch) return;
  int reader = host_file_open(s->name.c_str(), FILE_OPEN_READ);
  if (reader <= 0) return;
  int size = host_file_seek(reader, 0, SEEK_END);
  std::vector<char> old(size > 0 ? (size_t)size : 0);
  bool ok = size >= 0 && host_file_seek(reader, 0, SEEK_SET) == 0 &&
            (size == 0 || host_file_read(reader, old.data(), size) == size);
  host_file_close(reader);
  if (!ok) return;
  long long start = s->osPosition;
  host_file_seek(s->handle, (int)start, SEEK_SET); // writes the pending bytes
  if (start + s->mirrored <= size) {
    host_file_write(s->handle, old.data() + start, s->mirrored);
  } else {
    int writer = host_file_open(s->name.c_str(), FILE_OPEN_CREATE);
    if (writer > 0) {
      if (size > 0) host_file_write(writer, old.data(), size);
      host_file_close(writer);
    }
  }
  host_file_seek(s->handle, (int)start, SEEK_SET);
  s->mirrored = 0;
}

// After every operation: the host holds buffer[0, flushCount) as pending.
void mirrorSync(Stream *s) {
  if (s->mirrorLost) return;
  int n = flushCount(s);
  unsigned char now[BUFFER_SIZE];
  for (int i = 0; i < n; i++) now[i] = byteAt(s, i);
  if (s->mirrored > n || memcmp(s->mirror, now, (size_t)s->mirrored) != 0) mirrorRepair(s);
  if (s->mirrored > n || memcmp(s->mirror, now, (size_t)s->mirrored) != 0) return; // stale
  if (n > s->mirrored) {
    int r = host_file_write(s->handle, (const char *)now + s->mirrored, n - s->mirrored);
    if (r != n - s->mirrored) {
      s->mirrorLost = true; // e.g. a read-only stream: the flush will fail as it does in the original
      return;
    }
    memcpy(s->mirror + s->mirrored, now + s->mirrored, (size_t)(n - s->mirrored));
    s->mirrored = n;
  }
}

// The write of a flush: buffer[0, n) at the handle's position.  When the host
// holds exactly these bytes, they are already written as far as the host's
// other handles can tell at the next call; every caller makes one (fseek its
// lseek, fclose its close, fwrite the next mirror write or its own write,
// both of which the host can only take after writing the pending bytes).
int osWriteBuffer(Stream *s, int n) {
  if (n > 0 && s->mirrored == n && !s->mirrorLost) {
    s->mirrored = 0;
    s->osPosition += n;
    return n;
  }
  if (n > 0 && s->mirrored > 0) {
    // stale mirror (see mirrorRepair): the host writes it, then the right bytes go over it
    host_file_seek(s->handle, (int)s->osPosition, SEEK_SET);
    s->mirrored = 0;
  }
  std::vector<char> data(n > 0 ? (size_t)n : 0);
  for (int i = 0; i < n; i++) data[i] = (char)byteAt(s, i);
  return osWrite(s, data.data(), (unsigned)n);
}

// ---- the run-time's functions ----

// fflush(fp)
int bFlush(Stream *s) {
  if (s->level >= 0) {
    // reading (or nothing buffered): nothing to do; the buffered bytes stay
    if (s->flags & BF_LBUF) s->level = 0;
    return 0;
  }
  int n = s->bsize + s->level + 1;
  s->level -= n; // = -(bsize + 1): empty for writing
  s->curp = 0;
  if (osWriteBuffer(s, n) != n && !(s->flags & BF_TERM)) {
    s->flags |= BF_ERR;
    return -1;
  }
  return 0;
}

// _ffill(fp)
int bFill(Stream *s) {
  s->curp = 0;
  std::vector<char> data(BUFFER_SIZE);
  int r = osRead(s, data.data(), (unsigned)s->bsize);
  for (int i = 0; i < r; i++) putByte(s, i, (unsigned char)data[i]);
  s->level = r;
  if (r > 0) {
    s->flags &= ~BF_EOF;
    return 0;
  }
  if (r == 0) {
    s->flags = (unsigned short)((s->flags & ~(BF_IN | BF_OUT)) | BF_EOF);
  } else {
    s->level = 0;
    s->flags |= BF_ERR;
  }
  return -1;
}

// _fgetc(fp)
int bGetc(Stream *s) {
  if (s->level > 0) {
    s->level--;
    return byteAt(s, s->curp++);
  }
  if (s->level < 0 || (s->flags & (BF_OUT | BF_ERR)) || !(s->flags & BF_READ)) {
    s->flags |= BF_ERR;
    return EOF;
  }
  s->flags |= BF_IN;
  if (bFill(s) != 0) return EOF;
  s->level--;
  return byteAt(s, s->curp++);
}

// _fread(ptr, n, fp): returns the number of bytes NOT read.
unsigned bReadBytes(Stream *s, char *target, unsigned n) {
  for (;;) {
    if (n == 0) return 0;
    if (s->level != 0) {
      // The level is compared as an unsigned number: in the write state
      // (negative) it is huge, so the bytes are taken from the buffer.
      unsigned k = (unsigned)s->level < n ? (unsigned)s->level : n;
      copyFromBuffer(s, target, k);
      s->curp += k;
      s->level -= (int)k;
      if (k == n) return 0;
      target += k;
      n -= k;
    }
    if (n >= (unsigned)s->bsize) {
      unsigned m = n - n % (unsigned)s->bsize;
      int r = osRead(s, target, m);
      if ((unsigned)r == n) return 0; // also r == -1 for n == 0xFFFFFFFF
      if (r == -1) {
        s->flags |= BF_ERR;
        return n;
      }
      target += r;
      n -= (unsigned)r;
      if ((unsigned)r != m) {
        // binary mode, or nothing read: end of file
        s->flags |= BF_EOF;
        return n;
      }
    }
    int c = bGetc(s);
    if (c == EOF) {
      s->flags |= BF_EOF;
      return n;
    }
    checkTarget(target, 1);
    *target++ = (char)c;
    n--;
    if (n == 0) return 0;
  }
}

// _fwrite(ptr, n, fp): returns n, or 0 on error.
unsigned bWriteBytes(Stream *s, const char *source, unsigned n) {
  if (s->bsize != 0 && (unsigned)s->bsize >= n) {
    if (s->level + (int)n >= 0) {
      if (s->level == 0) {
        s->level = -1 - s->bsize; // start writing; curp stays where it is
      } else if (bFlush(s) != 0) {
        return 0; // (in the read state bFlush does nothing and the bytes go into the buffer)
      }
    }
    copyToBuffer(s, source, n);
    s->level += (int)n;
    s->curp += n;
    return n;
  }
  if (s->bsize != 0 && s->level != 0 && bFlush(s) != 0) return 0;
  int r = osWrite(s, source, n);
  if (r == -1 || (unsigned)r < n) return 0;
  return n;
}

Stream *newStream() {
  for (int i = 0; i < STREAM_SLOTS; i++)
    if (!streams[i].open) return &streams[i];
  return NULL;
}

} // namespace

// The current folder of the program moved (task 58 dialog): names of open
// files may now mean other files (see mirrorRepair).
void easy68k_files_folder_changed() { nameEpoch++; }

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

// ---------------------------------------------------------------------------
// The functions prelude.h puts in place of the C library's.
// ---------------------------------------------------------------------------
extern "C" FILE *easy68k_fopen(const char *name, const char *mode) {
  if (strcmp(mode, "rt") == 0) { // loadSrec()
    if (!stagedSrecordPresent) return NULL;
    cookie_io_functions_t io = {srecordRead, NULL, NULL, srecordClose};
    SrecordStream *stream = new SrecordStream();
    stream->position = 0;
    return fopencookie(stream, "r", io);
  }

  int hostMode;
  unsigned short flags;
  if (strcmp(mode, "r+b") == 0) {
    hostMode = FILE_OPEN_UPDATE;
    flags = BF_READ | BF_WRIT | BF_BIN;
  } else if (strcmp(mode, "rb") == 0) {
    hostMode = FILE_OPEN_READ;
    flags = BF_READ | BF_BIN;
  } else if (strcmp(mode, "w+b") == 0) {
    hostMode = FILE_OPEN_CREATE; // the host creates or truncates the file
    flags = BF_READ | BF_WRIT | BF_BIN;
  } else {
    return NULL; // no other mode is used by the original
  }
  // The run-time takes a free FILE first; without one the file is not opened.
  Stream *s = newStream();
  if (!s) return NULL;
  int handle = host_file_open(name, hostMode);
  if (handle <= 0) return NULL;
  s->open = true;
  s->flags = flags | BF_BUF;
  s->level = 0;
  s->bsize = BUFFER_SIZE;
  s->curp = 0;
  s->buffer = allocBlock();
  s->handle = handle;
  s->osPosition = 0;
  s->mirrored = 0;
  s->mirrorLost = false;
  s->name = name;
  s->nameEpoch = nameEpoch;
  return (FILE *)s;
}

extern "C" int easy68k_remove(const char *name) { return host_file_remove(name) == 0 ? 0 : -1; }

extern "C" size_t easy68k_fread(void *buffer, size_t size, size_t count, FILE *stream) {
  if (!isStream(stream)) return (fread)(buffer, size, count, stream);
  Stream *s = (Stream *)stream;
  if (size == 0) return 0;
  unsigned total = (unsigned)(size * count);
  unsigned left = bReadBytes(s, (char *)buffer, total);
  mirrorSync(s);
  return (total - left) / (unsigned)size;
}

extern "C" size_t easy68k_fwrite(const void *buffer, size_t size, size_t count, FILE *stream) {
  if (!isStream(stream)) return (fwrite)(buffer, size, count, stream);
  Stream *s = (Stream *)stream;
  if (size == 0) return count; // task 54 with D2 = 0 succeeds (T3: trap15-a/a31)
  unsigned total = (unsigned)(size * count);
  unsigned written = bWriteBytes(s, (const char *)buffer, total);
  mirrorSync(s);
  return written / (unsigned)size;
}

extern "C" int easy68k_fseek(FILE *stream, long offset, int whence) {
  if (!isStream(stream)) return (fseek)(stream, offset, whence);
  Stream *s = (Stream *)stream;
  int result;
  if (bFlush(s) != 0) {
    result = -1;
  } else {
    if (whence == SEEK_CUR && s->level > 0) offset -= s->level; // (the original passes SEEK_SET)
    s->flags &= ~(BF_EOF | BF_IN | BF_OUT);
    s->level = 0;
    s->curp = 0;
    result = osSeek(s, (int)offset, whence) < 0 ? -1 : 0;
  }
  mirrorSync(s);
  return result;
}

extern "C" int easy68k_fclose(FILE *stream) {
  if (stream == NULL) return EOF;
  if (!isStream(stream)) return (fclose)(stream);
  Stream *s = (Stream *)stream;
  if (!s->open) return EOF;
  if (s->level < 0 && bFlush(s) != 0) {
    // The stream stays as it is, with its buffer and its open handle: a file
    // that cannot be written keeps the handle until the program ends.
    mirrorSync(s);
    return EOF;
  }
  freeBlock(s->buffer);
  s->buffer = NULL;
  int r = host_file_close(s->handle) == 0 ? 0 : -1;
  s->open = false;
  s->flags = 0;
  s->bsize = 0;
  s->level = 0;
  s->handle = 0;
  s->mirrored = 0;
  return r;
}

extern "C" int easy68k_feof(FILE *stream) {
  if (!isStream(stream)) return (feof)(stream);
  return ((Stream *)stream)->flags & BF_EOF;
}

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
