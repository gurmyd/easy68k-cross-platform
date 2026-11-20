/*
 * ez_vcl.cpp - implementation of the VCL / RTL stand-in declared in ez_vcl.h.
 *
 * Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.
 */
#include "ez_internal.h"

/* ---- AnsiString ---------------------------------------------------------- */

void AnsiString::assign(const char *s, int n)
{
  char *d = (char *)malloc((size_t)n + 1);
  if (!d)
    throw std::bad_alloc();
  if (n)
    memcpy(d, s, (size_t)n);
  d[n] = '\0';
  data = d;
  len = n;
}

AnsiString::AnsiString() { assign("", 0); }
AnsiString::AnsiString(const char *s) { assign(s ? s : "", s ? (int)strlen(s) : 0); }
AnsiString::AnsiString(const AnsiString &s) { assign(s.data, s.len); }
AnsiString::AnsiString(char c) { assign(&c, 1); }
AnsiString::AnsiString(int value)
{
  char b[16];
  snprintf(b, sizeof b, "%d", value);
  assign(b, (int)strlen(b));
}
AnsiString::AnsiString(unsigned int value)
{
  char b[16];
  snprintf(b, sizeof b, "%u", value);
  assign(b, (int)strlen(b));
}
AnsiString::~AnsiString() { free(data); }

AnsiString &AnsiString::operator=(const AnsiString &s)
{
  if (this != &s) {
    char *old = data;
    assign(s.data, s.len);
    free(old);
  }
  return *this;
}

AnsiString &AnsiString::operator+=(const AnsiString &s)
{
  std::string t(data, (size_t)len);
  t.append(s.data, (size_t)s.len);
  char *old = data;
  assign(t.data(), (int)t.size());
  free(old);
  return *this;
}

AnsiString &AnsiString::operator+=(char c)
{
  return *this += AnsiString(c);
}

AnsiString AnsiString::operator+(const AnsiString &s) const
{
  AnsiString r(*this);
  r += s;
  return r;
}

AnsiString operator+(const char *a, const AnsiString &b)
{
  AnsiString r(a);
  r += b;
  return r;
}

bool AnsiString::operator==(const AnsiString &s) const
{
  return len == s.len && memcmp(data, s.data, (size_t)len) == 0;
}

bool AnsiString::operator==(const char *s) const
{
  return strcmp(data, s ? s : "") == 0;
}

AnsiString AnsiString::UpperCase() const
{
  /* Borland's AnsiString::UpperCase is locale aware; its only use in the
     engine (STRUCTURED.CPP:105) compares the result with "<GT>" etc., for
     which ASCII upper-casing gives the same answer. */
  AnsiString r(*this);
  for (int i = 0; i < r.len; i++)
    r.data[i] = (char)ez_toupper((unsigned char)r.data[i]);
  return r;
}

int AnsiString::AnsiCompareIC(const AnsiString &s) const
{
  return ez_stricmp(data, s.data);
}

AnsiString AnsiString::IntToHex(int value, int digits)
{
  /* Borland IntToHex: upper-case digits, at least 'digits' of them */
  char b[32];
  snprintf(b, sizeof b, "%0*X", digits, (unsigned int)value);
  return AnsiString(b);
}

AnsiString IntToStr(int value) { return AnsiString(value); }

int StrToInt(const AnsiString &s)
{
  /* OBJECT.CPP:249-252 passes "0x" + two hex digits */
  return (int)strtol(s.c_str(), 0, 0);
}

/* VCL file-name helpers. Delimiters are '\' and ':' (VCL LastDelimiter
   "\\:" and ".\\:"); the host passes names with '\' separators. */
static int lastDelimiter(const AnsiString &s, const char *delims)
{
  for (int i = s.Length() - 1; i >= 0; i--)
    if (strchr(delims, s.c_str()[i]))
      return i;
  return -1;
}

AnsiString ChangeFileExt(const AnsiString &fileName, const AnsiString &ext)
{
  int i = lastDelimiter(fileName, ".\\:");
  std::string s(fileName.c_str(), (size_t)fileName.Length());
  if (i < 0 || fileName.c_str()[i] != '.')
    i = fileName.Length();
  s = s.substr(0, (size_t)i) + ext.c_str();
  return AnsiString(s.c_str());
}

AnsiString ExtractFilePath(const AnsiString &fileName)
{
  int i = lastDelimiter(fileName, "\\:");
  std::string s(fileName.c_str(), (size_t)fileName.Length());
  return AnsiString(s.substr(0, (size_t)(i + 1)).c_str());
}

AnsiString ExtractFileName(const AnsiString &fileName)
{
  int i = lastDelimiter(fileName, "\\:");
  return AnsiString(fileName.c_str() + i + 1);
}

AnsiString ExpandFileName(const AnsiString &fileName)
{
  std::string k;
  if (ezCanonicalPath(fileName.c_str(), k))
    return AnsiString(k.c_str());
  return fileName;
}

/* ---- date and time -------------------------------------------------------- */

TDateTime ezNow = { 2000, 1, 1, 0, 0, 0 };

TDateTime Now() { return ezNow; }

/* Delphi/BCB DateTimeToStr with the default (empty) format = format 'c' =
   ShortDateFormat, then - unless the time is exactly midnight (hour,
   minute and second all zero) - a space and LongTimeFormat. With the
   en-US Windows locale ShortDateFormat is "M/d/yyyy" and LongTimeFormat is
   "h:mm:ss AMPM" (TimeAMString "AM", TimePMString "PM"). */
AnsiString DateTimeToStr(const TDateTime &t)
{
  char b[64];
  int n = snprintf(b, sizeof b, "%d/%d/%04d", t.month, t.day, t.year);
  if (t.hour != 0 || t.minute != 0 || t.second != 0) {
    int h = t.hour % 12;
    if (h == 0)
      h = 12;
    snprintf(b + n, sizeof b - (size_t)n, " %d:%02d:%02d %s", h, t.minute,
             t.second, t.hour < 12 ? "AM" : "PM");
  }
  return AnsiString(b);
}

/* ---- dialogs ---------------------------------------------------------------- */

std::vector<EzDialog> ezDialogs;

static TApplication theApplication;
TApplication *Application = &theApplication;

int TApplication::MessageBox(const char *text, const char *caption, int)
{
  EzDialog d;
  d.caption = caption ? caption : "";
  d.text = text ? text : "";
  ezDialogs.push_back(d);
  return 1;   /* IDOK */
}

void ShowMessage(const AnsiString &text)
{
  EzDialog d;
  d.caption = "";
  d.text = text.c_str();
  ezDialogs.push_back(d);
}

/* ---- editor objects ----------------------------------------------------------- */

int ezCurrentErrorCode = 0;
extern char includeFile[256];       /* GLOBALS.CPP:40 */

TListItem *TListItems::Add()
{
  TListItem *it = new TListItem;
  it->ezIncludeFile = includeFile;
  it->ezCode = ezCurrentErrorCode;
  rows.push_back(it);
  return it;
}

void TListItems::Clear()
{
  rows.clear();
}

int operator%(int j, const EzTabSize &t)
{
  if (t.value == 0)
    ez_fault(EZ_FAULT_DIVIDE);       /* x86 idiv by zero */
  if (t.value == -1)
    return 0;                        /* (j % -1) is 0; avoids INT_MIN % -1 */
  return j % t.value;
}

int operator-(const EzTabSize &t, int k) { return t.value - k; }

TTextStuff ezActiveWindow;
TTextStuff *TextStuff = 0;

static TMain theMain;
TMain *Main = &theMain;

void TMain::OpenFile(const AnsiString &)
{
  /* The original opens the include file in a new editor window, which then
     becomes the active window (ERROR.CPP:270-271). The port keeps one
     window; the message rows record the include file name instead. */
}

static TOptions theOptions;
TOptions *Options = &theOptions;

static TAssemblerBox theAssemblerBox;
TAssemblerBox *AssemblerBox = &theAssemblerBox;
