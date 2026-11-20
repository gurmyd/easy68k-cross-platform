// easy68k-mac: vcl.cpp - implementation of the stand-ins declared in
// shim/vcl/vcl.h, dos.h and Printers.hpp, and of the Borland run-time
// functions declared in prelude.h.
#include "vcl.h"
#include "dos.h"
#include "Printers.hpp"
#include "host.h"
#include "runloop.h"

// ---------------------------------------------------------------------------
// AnsiString
// ---------------------------------------------------------------------------
AnsiString &AnsiString::sprintf(const char *format, ...) {
  va_list args;
  va_start(args, format);
  va_list copy;
  va_copy(copy, args);
  int needed = vsnprintf(NULL, 0, format, copy);
  va_end(copy);
  if (needed < 0) needed = 0;
  std::string out((size_t)needed + 1, '\0');
  vsnprintf(&out[0], out.size(), format, args);
  va_end(args);
  out.resize((size_t)needed);
  s.swap(out);
  return *this;
}

AnsiString AnsiString::SubString(int index, int count) const {
  int length = (int)s.size();
  if (index < 1) index = 1;
  if (count < 0 || index > length) return AnsiString();
  if (count > length - index + 1) count = length - index + 1;
  return AnsiString(s.substr((size_t)(index - 1), (size_t)count));
}

// Upper / lower case of the ASCII letters only.  (The VCL also maps the
// accented letters of the ANSI code page.  The engine applies these functions
// to hexadecimal numbers, to the "*[sim68k]" listing directives and to listing
// lines whose first 8 characters are then compared with a hexadecimal
// address, so only ASCII matters.)
AnsiString AnsiString::UpperCase() const {
  std::string out(s);
  for (size_t i = 0; i < out.size(); i++)
    if (out[i] >= 'a' && out[i] <= 'z') out[i] = (char)(out[i] - 'a' + 'A');
  return AnsiString(out);
}

AnsiString AnsiString::LowerCase() const {
  std::string out(s);
  for (size_t i = 0; i < out.size(); i++)
    if (out[i] >= 'A' && out[i] <= 'Z') out[i] = (char)(out[i] - 'A' + 'a');
  return AnsiString(out);
}

AnsiString &AnsiString::Insert(const AnsiString &str, int index) {
  if (index < 1) index = 1;
  if (index > (int)s.size() + 1) index = (int)s.size() + 1;
  s.insert((size_t)(index - 1), str.s);
  return *this;
}

int AnsiString::ToInt() const { return StrToInt(*this); }

// Order of two strings as the relational operators of the VCL AnsiString give
// it.  Those call AnsiCompare, i.e. the Windows CompareString "word sort" of
// the user's locale, not a byte comparison.  The real tables are not
// available; this is the documented shape of that order for Windows-1252
// text, which is all the engine needs (it only orders 8-character listing
// prefixes against an upper-case hexadecimal address):
//   1. characters are compared by class first: everything that is not a
//      digit or a letter sorts before the digits, digits before letters;
//   2. letters are compared without regard to case;
//   3. if the strings are equal that way, a lower-case letter sorts before
//      the same letter in upper case at the first difference;
//   4. a string that is a prefix of the other sorts first.
// README.md lists this as an approximation (the exact order of punctuation
// among itself is the byte order here).
static int charClass(unsigned char c) {
  if (c >= '0' && c <= '9') return 1;
  if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c >= 0xC0) return 2;
  return 0;
}
static unsigned char foldCase(unsigned char c) {
  if (c >= 'a' && c <= 'z') return (unsigned char)(c - 'a' + 'A');
  return c;
}
int AnsiString::Compare(const AnsiString &a, const AnsiString &b) {
  const std::string &x = a.s;
  const std::string &y = b.s;
  size_t n = x.size() < y.size() ? x.size() : y.size();
  int caseDifference = 0;
  for (size_t i = 0; i < n; i++) {
    unsigned char cx = (unsigned char)x[i], cy = (unsigned char)y[i];
    if (cx == cy) continue;
    int kx = charClass(cx), ky = charClass(cy);
    if (kx != ky) return kx < ky ? -1 : 1;
    unsigned char fx = foldCase(cx), fy = foldCase(cy);
    if (fx != fy) return fx < fy ? -1 : 1;
    if (caseDifference == 0) caseDifference = (cx > cy) ? -1 : 1; // lower case first
  }
  if (x.size() != y.size()) return x.size() < y.size() ? -1 : 1;
  return caseDifference;
}

int StrToInt(const AnsiString &text) {
  const char *p = text.c_str();
  while (*p == ' ') p++;
  bool negative = false;
  if (*p == '+' || *p == '-') {
    negative = (*p == '-');
    p++;
  }
  unsigned int value = 0;
  int digits = 0;
  if (*p == '$' || ((p[0] == '0') && (p[1] == 'x' || p[1] == 'X')) || *p == 'x' || *p == 'X') {
    p += (*p == '0') ? 2 : 1;
    for (; *p; p++, digits++) {
      unsigned int d;
      if (*p >= '0' && *p <= '9') d = (unsigned int)(*p - '0');
      else if (*p >= 'a' && *p <= 'f') d = (unsigned int)(*p - 'a' + 10);
      else if (*p >= 'A' && *p <= 'F') d = (unsigned int)(*p - 'A' + 10);
      else throw EConvertError();
      if (value > 0x0FFFFFFFu) throw EConvertError(); // more than 32 bits
      value = (value << 4) | d;
    }
  } else {
    for (; *p; p++, digits++) {
      if (*p < '0' || *p > '9') throw EConvertError();
      unsigned int d = (unsigned int)(*p - '0');
      if (value > (0x7FFFFFFFu + (negative ? 1u : 0u) - d) / 10u) throw EConvertError();
      value = value * 10u + d;
    }
  }
  if (digits == 0) throw EConvertError();
  return negative ? (int)(0u - value) : (int)value;
}

// ---------------------------------------------------------------------------
// TextProp: assignment with the TMaskEdit rule and the OnChange hook
// ---------------------------------------------------------------------------
void TextProp::set(const AnsiString &text) {
  AnsiString next = text;
  if (maskLength > 0) {
    // "aaaaaa;0;0": exactly maskLength characters; a position that is not
    // filled, or holds a character the mask does not admit, reads as '0'.
    std::string out((size_t)maskLength, '0');
    const std::string &in = text.str();
    for (int i = 0; i < maskLength && i < (int)in.size(); i++) {
      unsigned char c = (unsigned char)in[i];
      bool ok = (maskKind == '9') ? (c >= '0' && c <= '9')
                                  : ((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z'));
      if (ok) out[(size_t)i] = (char)c;
    }
    next = AnsiString(out);
  }
  if (next == value) return; // no OnChange when the text does not change
  value = next;
  if (changed) changed();
}

// ---------------------------------------------------------------------------
// TFont, TApplication
// ---------------------------------------------------------------------------
void TFont::Assign(TFont *source) { host_font_assign(id, source ? source->id : 0); }

static TApplication theApplication;
TApplication *Application = &theApplication;

int TApplication::MessageBox(const char *text, const char *caption, int) {
  // Win32 MessageBox: "If lpCaption is NULL, the default title is Error."
  easy68k_alert(caption ? caption : "Error", text ? text : "");
  return 1; // IDOK
}

// ---------------------------------------------------------------------------
// Borland run-time library
// ---------------------------------------------------------------------------
extern "C" char *ultoa(unsigned long value, char *str, int radix) {
  char digits[40];
  int n = 0;
  if (radix < 2 || radix > 36) {
    str[0] = '\0';
    return str;
  }
  do {
    unsigned long d = value % (unsigned long)radix;
    digits[n++] = (char)(d < 10 ? '0' + d : 'a' + (d - 10));
    value /= (unsigned long)radix;
  } while (value != 0);
  char *out = str;
  while (n > 0) *out++ = digits[--n];
  *out = '\0';
  return str;
}

extern "C" char *itoa(int value, char *str, int radix) {
  // Borland: a negative value is printed with a minus sign only for radix 10.
  if (radix == 10 && value < 0) {
    str[0] = '-';
    ultoa(0ul - (unsigned long)value, str + 1, 10);
    return str;
  }
  return ultoa((unsigned long)(unsigned int)value, str, radix);
}

// <dos.h> gettime(): the host supplies hundredths of a second since midnight.
void gettime(struct time *timep) {
  unsigned int cs = host_time_centiseconds();
  timep->ti_hund = (unsigned char)(cs % 100);
  cs /= 100;
  timep->ti_sec = (unsigned char)(cs % 60);
  cs /= 60;
  timep->ti_min = (unsigned char)(cs % 60);
  cs /= 60;
  timep->ti_hour = (unsigned char)cs;
}

// ---------------------------------------------------------------------------
// <Printers.hpp>
// ---------------------------------------------------------------------------
TPrinterCanvas::TPrinterCanvas() : Font(new TFont(FONT_TARGET_PRINTER)) {}
int TPrinterCanvas::TextHeight(const AnsiString &) { return host_prn_metric(PRN_ROW_HEIGHT); }
int TPrinterCanvas::TextWidth(const AnsiString &) { return host_prn_metric(PRN_COL_WIDTH); }
void TPrinterCanvas::TextOut(int x, int y, const AnsiString &text) {
  host_prn_textOut(x, y, (unsigned char)text[1]);
}

TPrinter::TPrinter() : Canvas(new TPrinterCanvas()) {
  PageHeight.which = PRN_PAGE_HEIGHT;
  PageWidth.which = PRN_PAGE_WIDTH;
}
void TPrinter::BeginDoc() { host_prn_beginDoc(); }
void TPrinter::EndDoc() { host_prn_endDoc(); }
TPrinter::Metric::operator int() const { return host_prn_metric(which); }

TPrinter *Printer() {
  static TPrinter printer;
  return &printer;
}
