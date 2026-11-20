/*
 * ez_vcl.h - the smallest stand-in for the Borland VCL / RTL pieces that
 * the 16 assembler engine files use. Pulled in by the stub headers
 * <vcl.h>, <system.hpp>, "mainS.h", "textS.h", "assembleS.h" and
 * "editorOptions.h" in shim/include.
 *
 * Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.
 *
 * Every name here exists only because an engine file uses it; the file:line
 * of the use is given next to each declaration. Behaviour that is visible
 * to the user (message capture, the date string, the tab settings) is
 * documented in engine/asm/PATCHES.md, section "Shim decisions".
 */
#ifndef EZ_VCL_H
#define EZ_VCL_H

#include "ez_prelude.h"

/* ASSEMBLE.CPP:151-153 names stack<> and vector<> having included only
   <vcl.h>; in C++Builder the VCL headers bring the STL in. */
#include "include/stack.h"
#include "include/vector.h"

/* ------------------------------------------------------------------------
 * AnsiString (Borland dstring.h), only the members the engine uses:
 * ASSEMBLE.CPP:157-184, ERROR.CPP:248-288, LISTING.CPP:104-110,
 * OBJECT.CPP:237-252, STRUCTURED.CPP (concatenation, UpperCase, IntToHex,
 * comparison with char*, conversion from char* and from char),
 * DIRECTIV.CPP:710-714. c_str() returns a non-const char* as in Borland.
 * ---------------------------------------------------------------------- */
class AnsiString {
public:
  AnsiString();
  AnsiString(const char *s);
  AnsiString(const AnsiString &s);
  AnsiString(char c);            /* one-character string, as Borland */
  AnsiString(int value);         /* decimal text, as Borland */
  AnsiString(unsigned int value);
  ~AnsiString();

  AnsiString &operator=(const AnsiString &s);
  AnsiString &operator+=(const AnsiString &s);
  AnsiString &operator+=(char c);
  AnsiString operator+(const AnsiString &s) const;
  bool operator==(const AnsiString &s) const;
  bool operator==(const char *s) const;
  bool operator!=(const AnsiString &s) const { return !(*this == s); }

  char *c_str() const { return data; }
  int Length() const { return len; }
  bool IsEmpty() const { return len == 0; }
  AnsiString UpperCase() const;
  int AnsiCompareIC(const AnsiString &s) const;
  static AnsiString IntToHex(int value, int digits);

private:
  void assign(const char *s, int n);
  char *data;   /* never NULL, always NUL-terminated */
  int len;
};
AnsiString operator+(const char *a, const AnsiString &b);
typedef AnsiString String;

AnsiString IntToStr(int value);
int StrToInt(const AnsiString &s);
AnsiString ChangeFileExt(const AnsiString &fileName, const AnsiString &ext);
AnsiString ExtractFilePath(const AnsiString &fileName);
AnsiString ExtractFileName(const AnsiString &fileName);
AnsiString ExpandFileName(const AnsiString &fileName);

/* Date and time: LISTING.CPP:104 DateTimeToStr(Now()). Now() returns the
   time the host supplied for this assembly (ez_set_time). */
struct TDateTime {
  int year, month, day, hour, minute, second;
};
TDateTime Now();
AnsiString DateTimeToStr(const TDateTime &t);

/* ------------------------------------------------------------------------
 * Message boxes (ASSEMBLE.CPP:166/172, LISTING.CPP:99/165/247,
 * OBJECT.CPP:135/219/260/353, CODEGEN.CPP:120/203) and ShowMessage
 * (ERROR.CPP:261). They are recorded for the host instead of shown.
 * ---------------------------------------------------------------------- */
#define MB_OK 0
struct TApplication {
  int MessageBox(const char *text, const char *caption, int flags);
};
extern TApplication *Application;
void ShowMessage(const AnsiString &text);

/* CODEGEN.CPP:80-81: an unused "TMsgDlgButtons temp_set; temp_set << mbOK;" */
enum TMsgDlgBtn { mbYes, mbNo, mbOK, mbCancel };
struct TMsgDlgButtons {
  TMsgDlgButtons &operator<<(TMsgDlgBtn) { return *this; }
};

/* asm.h:243-259 declares the editor's syntax colours with these names. */
typedef int TColor;
const TColor clBlack = 0x000000, clMaroon = 0x000080, clGreen = 0x008000,
             clOlive = 0x008080, clPurple = 0x800080, clTeal = 0x808000,
             clRed = 0x0000FF, clBlue = 0xFF0000, clWhite = 0xFFFFFF;

/* ------------------------------------------------------------------------
 * The editor objects the engine touches (all GUI side effects):
 *   Main->ActiveMDIChild, Main->MDIChildCount, Main->MDIChildren[i],
 *   Main->OpenFile(...)                         ASSEMBLE.CPP:211, ERROR.CPP:251-275,
 *                                               DIRECTIV.CPP:711-712, LISTING.CPP:128
 *   Active->Messages->Height/Enabled/Items      ASSEMBLE.CPP:212, ERROR.CPP:277-288,
 *                                               DIRECTIV.CPP:715-717
 *   Active->Project.CurrentFile/Modified/TabType/TabSize
 *   TextStuff (global), BringToFront()          ERROR.CPP:252-266, DIRECTIV.CPP:712
 *   Options->chkGenList->Checked                ASSEMBLE.CPP:177
 *   AssemblerBox->lblStatus/lblStatus2/cmdExecute  ASSEMBLE.CPP:215-220
 * The port has exactly one editor window: the one being assembled. Its
 * message list is what the host receives as the message list.
 * ---------------------------------------------------------------------- */
struct TStrings {
  std::vector<AnsiString> items;
  void Add(const AnsiString &s) { items.push_back(s); }
};

struct TListItem {
  AnsiString Caption;          /* line number column (ERROR.CPP:285) */
  TStrings *SubItems;          /* [0] message, [1] file (ERROR.CPP:287-288) */
  /* Recorded by the shim when the row is added: */
  AnsiString ezIncludeFile;    /* includeFile[] at that moment ("" = main file) */
  int ezCode;                  /* status code passed to printError() */
  TListItem() : SubItems(new TStrings), ezCode(0) {}
};

struct TListItems {
  std::vector<TListItem *> rows;
  TListItem *Add();
  void Clear();
};

struct TListView {
  int Height;
  bool Enabled;
  TListItems *Items;
  TListView() : Height(0), Enabled(false), Items(new TListItems) {}
};

/* Fixed tab size with Borland's divide-error behaviour for a size of 0:
   LISTING.CPP:143 computes "TabSize - (j % TabSize)". A zero divisor makes
   the x86 idiv fault, which Borland turns into an exception caught by
   listLine()'s catch(...). The shim reproduces that by throwing. */
struct EzTabSize {
  int value;
  EzTabSize() : value(4) {}
  EzTabSize &operator=(int v) { value = v; return *this; }
  operator int() const { return value; }
};
int operator%(int j, const EzTabSize &t);
int operator-(const EzTabSize &t, int k);

struct TProjectInfo {
  AnsiString CurrentFile;
  bool Modified;
  int TabType;                 /* 0 = Assembly, 1 = Fixed (asm.h tabTypes) */
  EzTabSize TabSize;
  TProjectInfo() : Modified(false), TabType(1) {}
};

class TTextStuff {
public:
  TProjectInfo Project;
  TListView *Messages;
  TTextStuff() : Messages(new TListView) {}
  void BringToFront() {}
};
extern TTextStuff *TextStuff;

struct EzMdiChildren {
  TTextStuff *operator[](int) const { return 0; }
};

class TMain {
public:
  TTextStuff *ActiveMDIChild;
  int MDIChildCount;           /* other editor windows: none in the port */
  EzMdiChildren MDIChildren;
  void OpenFile(const AnsiString &name);
  TMain() : ActiveMDIChild(0), MDIChildCount(0) {}
};
extern TMain *Main;

struct TCheckBox { bool Checked; TCheckBox() : Checked(false) {} };
struct TOptions {
  TCheckBox *chkGenList;
  TOptions() : chkGenList(new TCheckBox) {}
};
extern TOptions *Options;

struct TLabel { AnsiString Caption; };
struct TButton { bool Enabled; TButton() : Enabled(false) {} };
struct TAssemblerBox {
  TLabel *lblStatus, *lblStatus2;
  TButton *cmdExecute;
  TAssemblerBox() : lblStatus(new TLabel), lblStatus2(new TLabel), cmdExecute(new TButton) {}
};
extern TAssemblerBox *AssemblerBox;

#endif /* EZ_VCL_H */
