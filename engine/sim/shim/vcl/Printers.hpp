// easy68k-mac: stand-in for Borland's <Printers.hpp>.
// CODE9.CPP (TRAP #15 task 10) keeps the page layout arithmetic (margins,
// line feed, form feed) and calls the printer only for: start / end of a
// document, the size of a character cell and of the page, and drawing one
// character.  Each of those is a host import (shim/host.h).
#ifndef EASY68K_PRINTERS_HPP
#define EASY68K_PRINTERS_HPP

#include "vcl.h"

class TPrinterCanvas {
public:
  TPrinterCanvas();
  TFont *Font;
  int TextHeight(const AnsiString &text);
  int TextWidth(const AnsiString &text);
  void TextOut(int x, int y, const AnsiString &text);
};

class TPrinter {
public:
  TPrinter();
  void BeginDoc();
  void EndDoc();
  TPrinterCanvas *Canvas;
  // Read-only properties: the value is asked from the host on every read.
  struct Metric {
    int which;
    operator int() const;
  };
  Metric PageHeight;
  Metric PageWidth;
};

TPrinter *Printer();

#endif
