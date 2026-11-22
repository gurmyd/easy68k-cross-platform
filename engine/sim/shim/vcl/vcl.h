// easy68k-mac: vcl.h
//
// Stand-in for Borland's <vcl.h>.  The original simulator core calls the
// Visual Component Library in a few dozen places (strings, the message area,
// text boxes, check boxes, timers).  This header supplies just enough of
// those classes, with the same names and the same call syntax, for the
// original statements to compile unchanged.  The stand-ins hold the state the
// original kept inside GUI controls (so that it is part of the engine and
// behaves the same with or without a user interface) and report changes to
// the host through the imports declared in shim/host.h.
//
// Nothing here is a general VCL replacement: each class has only the members
// the engine uses.
#ifndef EASY68K_VCL_H
#define EASY68K_VCL_H

#include <string>
#include <vector>

// ---------------------------------------------------------------------------
// Exceptions.  The original relies on VCL exceptions in three places: a bad
// number text (EConvertError from StrToInt), an index past the end of the
// listing (EStringListError), and anything else caught by "catch (...)".
// The stand-ins throw the same way so that the original try/catch code keeps
// its meaning.
// ---------------------------------------------------------------------------
class Exception {};
class EConvertError : public Exception {};
class EStringListError : public Exception {};
// Thrown by the recursion guard in mem_req (see PATCHES.md, "Unbounded
// recursion"); stands for the stack overflow the original would run into.
class EStackOverflow : public Exception {};
// Thrown by the file streams (shim/hostfile.cpp) where the original's run-time
// would copy past the end of its memory: an access violation, which the
// original's "catch (...)" handlers catch as well.
class EAccessViolation : public Exception {};

// ---------------------------------------------------------------------------
// AnsiString: a byte string with 1-based indexing.
// ---------------------------------------------------------------------------
class AnsiString {
public:
  AnsiString() {}
  AnsiString(const char *p) : s(p ? p : "") {}
  AnsiString(const char *p, size_t n) : s(p, n) {}
  AnsiString(char c) : s(1, c) {}
  AnsiString(const std::string &str) : s(str) {}

  // printf-style formatting into this string; returns *this like the VCL.
  AnsiString &sprintf(const char *format, ...);

  const char *c_str() const { return s.c_str(); }
  int Length() const { return (int)s.size(); }
  bool IsEmpty() const { return s.empty(); }

  // 1-based character access.  The VCL does not range-check this in release
  // builds; the stand-in returns 0 for an index outside the string so that the
  // read is defined (PATCHES.md, "Reads outside objects").
  char operator[](int index) const {
    return (index >= 1 && index <= (int)s.size()) ? s[index - 1] : '\0';
  }

  // Delphi Copy(): 1-based start, clamps to the string.
  AnsiString SubString(int index, int count) const;
  AnsiString UpperCase() const;
  AnsiString LowerCase() const;
  // Delphi Insert(): index below 1 means 1; index past the end appends.
  AnsiString &Insert(const AnsiString &str, int index);
  // Decimal StrToInt of the whole string.
  int ToInt() const;

  AnsiString &operator+=(const AnsiString &rhs) {
    s += rhs.s;
    return *this;
  }

  const std::string &str() const { return s; }

  // Ordering as the VCL does it (AnsiCompare, i.e. the Windows locale order).
  // See AnsiString.cpp for the approximation used.
  static int Compare(const AnsiString &a, const AnsiString &b);

private:
  std::string s;
};
typedef AnsiString String;

inline AnsiString operator+(const AnsiString &a, const AnsiString &b) {
  return AnsiString(a.str() + b.str());
}
// Equality is byte equality; the relational operators use the locale order.
inline bool operator==(const AnsiString &a, const AnsiString &b) { return a.str() == b.str(); }
inline bool operator!=(const AnsiString &a, const AnsiString &b) { return a.str() != b.str(); }
inline bool operator<(const AnsiString &a, const AnsiString &b) { return AnsiString::Compare(a, b) < 0; }
inline bool operator>(const AnsiString &a, const AnsiString &b) { return AnsiString::Compare(a, b) > 0; }
inline bool operator<=(const AnsiString &a, const AnsiString &b) { return AnsiString::Compare(a, b) <= 0; }
inline bool operator>=(const AnsiString &a, const AnsiString &b) { return AnsiString::Compare(a, b) >= 0; }

// StrToInt: optional blanks, optional sign, then decimal digits, or "0x" / "$"
// and hexadecimal digits.  Anything else throws EConvertError, as in the VCL.
int StrToInt(const AnsiString &text);

// ---------------------------------------------------------------------------
// Properties.  Assigning to a VCL property can run an event handler (OnChange,
// OnClick).  The original depends on that (for example SIMOPS2.CPP sets the
// memory map only through check boxes and edit boxes), so the stand-ins have
// the same hook: "changed" runs when, and only when, the value really changes.
// ---------------------------------------------------------------------------
typedef void (*TNotify)();

class TextProp {
public:
  TextProp() : changed(0), maskLength(0), maskKind(0) {}
  operator const AnsiString &() const { return value; }
  const AnsiString &get() const { return value; }
  char operator[](int index) const { return value[index]; }
  const char *c_str() const { return value.c_str(); }
  AnsiString SubString(int index, int count) const { return value.SubString(index, count); }
  int ToInt() const { return value.ToInt(); }
  TextProp &operator=(const AnsiString &text) {
    set(text);
    return *this;
  }
  TextProp &operator=(const TextProp &other) {
    set(other.value);
    return *this;
  }
  void set(const AnsiString &text);
  // Store without running the change handler (used while constructing).
  void init(const AnsiString &text) { value = text; }

  TNotify changed; // OnChange
  // TMaskEdit masks of the form "aaaaaa;0;0" / "9999;0;0": a fixed number of
  // optional characters with '0' as the blank.  maskLength 0 = no mask.
  // maskKind 'a' = alphanumeric, '9' = digit.
  int maskLength;
  char maskKind;

private:
  AnsiString value;
};

class BoolProp {
public:
  BoolProp() : changed(0), value(false) {}
  operator bool() const { return value; }
  BoolProp &operator=(bool v) {
    if (v != value) {
      value = v;
      if (changed) changed();
    }
    return *this;
  }
  BoolProp &operator=(const BoolProp &other) { return *this = other.value; }
  void init(bool v) { value = v; }
  TNotify changed; // OnClick / state change

private:
  bool value;
};

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------
class TObject {};
class TComponent : public TObject {};

// Fonts are a host matter.  The engine only passes on "apply font X to
// surface Y" (initSim does that five times); see host_font_assign().
class TFont {
public:
  explicit TFont(int ident = 0) : id(ident) {}
  void Assign(TFont *source);
  int id; // FONT_* in host.h
};

// TEdit / TMaskEdit.  Text and EditText are the same string here: none of the
// masks used by the engine has literal characters.
class TEdit {
public:
  TEdit() : EditText(Text) {}
  TextProp Text;
  TextProp &EditText;

private:
  TEdit(const TEdit &);
  TEdit &operator=(const TEdit &);
};
typedef TEdit TMaskEdit;

class TCheckBox {
public:
  BoolProp Checked;
};

class TMenuItem {
public:
  BoolProp Checked;
  BoolProp Enabled;
};

class TLabel {
public:
  TLabel() : Font(new TFont(0)) {}
  TextProp Caption;
  TFont *Font;
};

class TFontDialog {
public:
  explicit TFontDialog(int ident) : Font(new TFont(ident)) {}
  TFont *Font;
};

// TStrings: the lines of a list box or memo.
class TStrings {
public:
  TStrings() : Count(0), Strings(*this), keep(true), cleared(0), added(0) {}
  int Count;
  void Clear() {
    lines.clear();
    Count = 0;
    if (cleared) cleared();
  }
  int Add(const AnsiString &line) {
    if (keep) lines.push_back(line);
    Count++;
    if (added) added(line);
    return Count - 1;
  }
  // Strings[i]: throws EStringListError outside 0..Count-1, like the VCL
  // ("List index out of bounds").
  struct Indexer {
    explicit Indexer(TStrings &o) : owner(o) {}
    const AnsiString &operator[](int index) const {
      if (index < 0 || index >= (int)owner.lines.size()) throw EStringListError();
      return owner.lines[index];
    }
    TStrings &owner;
  } Strings;

  // keep = false: the lines are only passed on (to "added"), not stored.
  bool keep;
  TNotify cleared;
  void (*added)(const AnsiString &line);

private:
  std::vector<AnsiString> lines;
  TStrings(const TStrings &);
  TStrings &operator=(const TStrings &);
};

// Colours used by initSim (TColor is 0x00BBGGRR).
const int clBlack = 0x00000000;
const int clWhite = 0x00FFFFFF;

// Message-box flags (the engine only ever shows OK boxes).
const int MB_OK = 0;

class TApplication {
public:
  // A modal box with an OK button.  The engine reports it to the host and
  // records that a box is open; see "Wait states" in README.md.
  int MessageBox(const char *text, const char *caption, int flags);
};
extern TApplication *Application;

#endif
