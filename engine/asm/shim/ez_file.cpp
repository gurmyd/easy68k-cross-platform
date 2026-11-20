/*
 * ez_file.cpp - the shim's in-memory file layer.
 *
 * Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.
 *
 * The engine opens files with fopen() and reads/writes them with fgets,
 * fprintf, fputs, putc, fread, fseek, ftell, rewind (see the call list in
 * engine/asm/PATCHES.md). ez_prelude.h redirects those names here. All
 * files live in memory: the host supplies the input files before the run
 * and collects the output files after it.
 *
 * Windows C-runtime semantics reproduced per open file:
 *   - Mode without 'b' is text mode (the CRT default _fmode = O_TEXT).
 *     Reading: CR is removed before LF (see EZ_TEXT_DROP_ALL_CR), and
 *     a Ctrl-Z byte (0x1A) is end of file. Writing: LF is written as CR LF.
 *     ftell()/fseek() work on raw byte offsets, so ftell() after text-mode
 *     writes counts two bytes per line end - which is what makes the macro
 *     symbol values (temp-file offsets) match the original.
 *   - Mode with 'b' is binary: bytes pass unchanged.
 *   - "r"/"rb" fail when the file does not exist; "w"/"w+" create or
 *     truncate.
 *   - feof() becomes true only after a read has hit the end.
 *
 * Name resolution follows Windows: '\' and '/' are both separators, names
 * are case-insensitive (Windows-1252 letters included), "." and ".." are
 * resolved, trailing dots and spaces of a component are ignored, relative
 * names are resolved against the current directory (the folder of the
 * main source, as SetCurrentDir() in mainS.cpp:370 makes it), and names
 * containing characters Windows forbids (< > : " | ? * and control
 * characters such as TAB) cannot be opened.
 */
#include "ez_internal.h"

/* ---- configuration ---------------------------------------------------- */

/* Text-mode read: does the C runtime remove EVERY carriage return, or only
   the CR of a CR LF pair? Microsoft's CRT removes only CR before LF.
   Borland's run-time library documentation for read() says "If the file was
   opened in text mode, read removes carriage returns"; the exact behaviour
   of the Borland RTL that EDIT68K.EXE 5.16.1 links is UNVERIFIED. It only
   matters for a CR that is not followed by LF inside an INCLUDE file (the
   main source always reaches the assembler with CR LF line ends). The
   choice is one constant: 1 = remove every CR (Borland documentation),
   0 = remove CR only before LF (Microsoft). */
#ifndef EZ_TEXT_DROP_ALL_CR
#define EZ_TEXT_DROP_ALL_CR 1
#endif

/* Simultaneously open files. The Borland RTL has a fixed table of _NFILE_
   (50) streams, of which stdin, stdout and stderr are always in use; when it
   is full fopen() fails and the engine reports "Unable to access specified
   file" (this is what ends an INCLUDE that includes itself). The exact
   number available to EDIT68K is UNVERIFIED; 47 is used here. */
#ifndef EZ_MAX_OPEN_FILES
#define EZ_MAX_OPEN_FILES 47
#endif

/* ---- state ------------------------------------------------------------ */

std::vector<EzNode> ezNodes;
std::string ezCwd;

struct EzFile {
  int node;
  long pos;
  bool text;
  bool canRead;
  bool canWrite;
  bool eof;
  bool err;
};

static int openCount = 0;
int ezOpenFileCount() { return openCount; }

/* ---- names ------------------------------------------------------------- */

/* Upper case for Windows-1252, as a case-insensitive file system compares. */
static unsigned char foldCase(unsigned char c)
{
  if (c >= 'a' && c <= 'z') return (unsigned char)(c - 32);
  if (c >= 0xE0 && c <= 0xFE && c != 0xF7) return (unsigned char)(c - 32);
  if (c == 0x9A) return 0x8A;   /* s caron */
  if (c == 0x9C) return 0x8C;   /* oe */
  if (c == 0x9E) return 0x8E;   /* z caron */
  if (c == 0xFF) return 0x9F;   /* y diaeresis */
  return c;
}

static bool badChar(unsigned char c)
{
  return c < 0x20 || c == '<' || c == '>' || c == ':' || c == '"' ||
         c == '|' || c == '?' || c == '*';
}

static void splitComponents(const std::string &s, std::vector<std::string> &parts)
{
  std::string cur;
  for (size_t i = 0; i <= s.size(); i++) {
    if (i == s.size() || s[i] == '\\') {
      if (!cur.empty()) parts.push_back(cur);
      cur.clear();
    } else
      cur += s[i];
  }
}

bool ezCanonicalPath(const char *name, std::string &out)
{
  if (!name || !*name)
    return false;
  std::string s(name);
  for (size_t i = 0; i < s.size(); i++)
    if (s[i] == '/') s[i] = '\\';

  std::string prefix;                 /* "" (virtual root) or "X:" */
  std::vector<std::string> parts;
  std::string rest;

  bool hasDrive = s.size() >= 2 && s[1] == ':' &&
                  ((s[0] >= 'A' && s[0] <= 'Z') || (s[0] >= 'a' && s[0] <= 'z'));
  if (hasDrive) {
    prefix = std::string(1, (char)foldCase((unsigned char)s[0])) + ":";
    rest = s.substr(2);
    if (rest.empty() || rest[0] != '\\') {
      /* "C:name" - relative to the current directory when that is on the
         same drive, otherwise to the root of that drive */
      if (ezCwd.size() >= 2 && ezCwd.substr(0, 2) == prefix)
        splitComponents(ezCwd.substr(2), parts);
    }
  } else if (!s.empty() && s[0] == '\\') {
    /* "\name" or "\\server\share\name": root of the current drive */
    prefix = (ezCwd.size() >= 2 && ezCwd[1] == ':') ? ezCwd.substr(0, 2) : "";
    rest = s;
  } else {
    /* relative name */
    if (ezCwd.size() >= 2 && ezCwd[1] == ':') {
      prefix = ezCwd.substr(0, 2);
      splitComponents(ezCwd.substr(2), parts);
    } else
      splitComponents(ezCwd, parts);
    rest = s;
  }

  std::vector<std::string> add;
  splitComponents(rest, add);
  for (size_t i = 0; i < add.size(); i++) {
    std::string c = add[i];
    if (c == ".")
      continue;
    if (c == "..") {
      if (!parts.empty()) parts.pop_back();
      continue;
    }
    /* Win32 ignores trailing dots and spaces of a name component */
    while (!c.empty() && (c[c.size() - 1] == '.' || c[c.size() - 1] == ' '))
      c.erase(c.size() - 1);
    if (c.empty())
      continue;
    for (size_t k = 0; k < c.size(); k++)
      if (badChar((unsigned char)c[k]))
        return false;
    parts.push_back(c);
  }
  if (parts.empty())
    return false;                     /* a directory, not a file */

  out = prefix;
  for (size_t i = 0; i < parts.size(); i++) {
    out += '\\';
    for (size_t k = 0; k < parts[i].size(); k++)
      out += (char)foldCase((unsigned char)parts[i][k]);
  }
  return true;
}

void ezSetCwdFromPath(const char *fileName)
{
  /* The directory part of the canonical form of fileName. */
  std::string key;
  ezCwd.clear();
  if (!ezCanonicalPath(fileName, key))
    return;
  size_t p = key.rfind('\\');
  ezCwd = (p == std::string::npos) ? std::string() : key.substr(0, p);
}

int ezFindNode(const std::string &key)
{
  for (size_t i = 0; i < ezNodes.size(); i++)
    if (!ezNodes[i].deleted && ezNodes[i].key == key)
      return (int)i;
  return -1;
}

int ezAddNode(const char *name, const unsigned char *data, int len)
{
  std::string key;
  if (!ezCanonicalPath(name, key))
    return -1;
  int i = ezFindNode(key);
  if (i < 0) {
    EzNode n;
    n.key = key;
    n.name = name;
    n.deleted = false;
    ezNodes.push_back(n);
    i = (int)ezNodes.size() - 1;
  }
  ezNodes[i].data.assign(data, data + (len > 0 ? len : 0));
  return i;
}

void ezDeleteFile(const char *name)
{
  std::string key;
  if (!ezCanonicalPath(name, key))
    return;
  int i = ezFindNode(key);
  if (i >= 0)
    ezNodes[i].deleted = true;
}

/* ---- streams ------------------------------------------------------------ */

EzFile *ez_fopen(const char *name, const char *mode)
{
  if (openCount >= EZ_MAX_OPEN_FILES)
    return 0;
  std::string key;
  if (!ezCanonicalPath(name, key))
    return 0;
  bool binary = strchr(mode, 'b') != 0;
  bool plus = strchr(mode, '+') != 0;
  int node = ezFindNode(key);
  EzFile *f = new EzFile;
  f->pos = 0;
  f->text = !binary;
  f->eof = false;
  f->err = false;
  if (mode[0] == 'r') {
    if (node < 0) {
      delete f;
      return 0;
    }
    f->canRead = true;
    f->canWrite = plus;
  } else if (mode[0] == 'w' || mode[0] == 'a') {
    if (node < 0) {
      EzNode n;
      n.key = key;
      n.name = name;
      n.deleted = false;
      ezNodes.push_back(n);
      node = (int)ezNodes.size() - 1;
    } else if (mode[0] == 'w')
      ezNodes[node].data.clear();
    f->canRead = plus;
    f->canWrite = true;
    if (mode[0] == 'a')
      f->pos = (long)ezNodes[node].data.size();
  } else {
    delete f;
    return 0;
  }
  f->node = node;
  openCount++;
  return f;
}

int ez_fclose(EzFile *f)
{
  if (!f)
    return EOF;
  delete f;
  openCount--;
  return 0;
}

static std::vector<unsigned char> &bytesOf(EzFile *f)
{
  return ezNodes[f->node].data;
}

/* One character as the program sees it, or EOF. */
static int readChar(EzFile *f)
{
  std::vector<unsigned char> &d = bytesOf(f);
  for (;;) {
    if (f->pos >= (long)d.size()) {
      f->eof = true;
      return EOF;
    }
    unsigned char c = d[f->pos];
    if (f->text) {
      if (c == 0x1A) {                /* Ctrl-Z: end of file in text mode */
        f->eof = true;
        return EOF;
      }
      if (c == '\r') {
        if (f->pos + 1 < (long)d.size() && d[f->pos + 1] == '\n') {
          f->pos += 2;
          return '\n';
        }
        if (EZ_TEXT_DROP_ALL_CR) {
          f->pos++;
          continue;
        }
      }
    }
    f->pos++;
    return c;
  }
}

static void writeBytes(EzFile *f, const char *s, size_t n)
{
  std::vector<unsigned char> &d = bytesOf(f);
  for (size_t i = 0; i < n; i++) {
    unsigned char c = (unsigned char)s[i];
    if (f->text && c == '\n') {
      static const unsigned char crlf[2] = { '\r', '\n' };
      for (int k = 0; k < 2; k++) {
        if (f->pos < (long)d.size()) d[f->pos] = crlf[k];
        else d.push_back(crlf[k]);
        f->pos++;
      }
    } else {
      if (f->pos < (long)d.size()) d[f->pos] = c;
      else d.push_back(c);
      f->pos++;
    }
  }
}

char *ez_fgets(char *buf, int n, EzFile *f)
{
  if (!f || !f->canRead || n <= 0)
    return 0;
  if (f->eof)
    return 0;
  int i = 0;
  while (i < n - 1) {
    int c = readChar(f);
    if (c == EOF)
      break;
    buf[i++] = (char)c;
    if (c == '\n')
      break;
  }
  if (i == 0 && n > 1)
    return 0;
  buf[i] = '\0';
  return buf;
}

int ez_fputs(const char *s, EzFile *f)
{
  if (!f || !f->canWrite) {
    if (f) f->err = true;
    return EOF;
  }
  writeBytes(f, s, strlen(s));
  return 0;
}

int ez_fputc(int c, EzFile *f)
{
  if (!f || !f->canWrite) {
    if (f) f->err = true;
    return EOF;
  }
  char ch = (char)c;
  writeBytes(f, &ch, 1);
  return (unsigned char)c;
}

int ez_fprintf(EzFile *f, const char *fmt, ...)
{
  if (!f || !f->canWrite) {
    if (f) f->err = true;
    return -1;
  }
  char small[1024];
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(small, sizeof small, fmt, ap);
  va_end(ap);
  if (n < 0)
    return n;                          /* invalid format: nothing written */
  if (n < (int)sizeof small) {
    writeBytes(f, small, (size_t)n);
    return n;
  }
  std::vector<char> big((size_t)n + 1);
  va_start(ap, fmt);
  vsnprintf(&big[0], big.size(), fmt, ap);
  va_end(ap);
  writeBytes(f, &big[0], (size_t)n);
  return n;
}

size_t ez_fread(void *buf, size_t size, size_t count, EzFile *f)
{
  if (!f || !f->canRead || size == 0)
    return 0;
  unsigned char *out = (unsigned char *)buf;
  size_t done = 0;
  for (; done < count; done++) {
    for (size_t k = 0; k < size; k++) {
      int c = readChar(f);
      if (c == EOF)
        return done;
      out[done * size + k] = (unsigned char)c;
    }
  }
  return done;
}

size_t ez_fwrite(const void *buf, size_t size, size_t count, EzFile *f)
{
  if (!f || !f->canWrite)
    return 0;
  writeBytes(f, (const char *)buf, size * count);
  return count;
}

int ez_feof(EzFile *f) { return f && f->eof ? 1 : 0; }
int ez_ferror(EzFile *f) { return f && f->err ? 1 : 0; }

int ez_fseek(EzFile *f, long offset, int whence)
{
  if (!f)
    return -1;
  long base = 0;
  if (whence == SEEK_CUR) base = f->pos;
  else if (whence == SEEK_END) base = (long)bytesOf(f).size();
  if (base + offset < 0)
    return -1;
  f->pos = base + offset;
  f->eof = false;
  return 0;
}

long ez_ftell(EzFile *f)
{
  return f ? f->pos : -1L;
}

void ez_rewind(EzFile *f)
{
  if (!f)
    return;
  f->pos = 0;
  f->eof = false;
  f->err = false;
}

/* ---- other C run-time pieces -------------------------------------------- */

void ez_fault(int kind)
{
  EzCpuFault e;
  e.kind = kind;
  throw e;
}

int ez_sprintf(char *dst, const char *fmt, ...)
{
  if (!dst)
    ez_fault(EZ_FAULT_ACCESS);
  va_list ap;
  va_start(ap, fmt);
  int n = vsprintf(dst, fmt, ap);
  va_end(ap);
  return n;
}

int ez_stricmp(const char *a, const char *b)
{
  for (;; a++, b++) {
    int ca = ez_tolower((unsigned char)*a), cb = ez_tolower((unsigned char)*b);
    if (ca != cb || !ca)
      return ca - cb;
  }
}

int ez_strnicmp(const char *a, const char *b, size_t n)
{
  for (; n; n--, a++, b++) {
    int ca = ez_tolower((unsigned char)*a), cb = ez_tolower((unsigned char)*b);
    if (ca != cb || !ca)
      return ca - cb;
  }
  return 0;
}

char *ez_itoa(int value, char *buf, int radix)
{
  /* only radix 10 is used (MACRO.CPP:276) */
  (void)radix;
  snprintf(buf, 16, "%d", value);
  return buf;
}
