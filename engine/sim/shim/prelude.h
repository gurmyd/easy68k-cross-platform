// easy68k-mac: prelude.h
//
// Force-included (em++ -include) in front of every C++ file of the simulator
// engine, original and new alike.  It supplies what the original sources took
// from Borland C++ Builder 6 and from the Windows headers that <vcl.h> pulled
// in, so that the original files need no edits for these things:
//
//   * the standard headers the originals use without including them
//     (<string.h>, <stdlib.h>); they must also come BEFORE def.h, because
//     def.h says "#define uint unsigned int" (and ushort, uchar), which would
//     break the typedefs of the same names in the C library headers;
//   * Borland keywords (__fastcall, __int64);
//   * the Windows types named in var.h / extern.h (byte, HRESULT, ...);
//   * Borland run-time functions (itoa, ultoa);
//   * the redirection of fopen() / remove() to the host file boundary.
//
// See PATCHES.md, section "Build-level substitutions".
#ifndef EASY68K_PRELUDE_H
#define EASY68K_PRELUDE_H

#include <assert.h>
#include <ctype.h>
#include <limits.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef __cplusplus
#include <algorithm>
#include <stack>
#include <string>
#include <vector>
#endif

// ---- Borland keywords -------------------------------------------------------
#define __fastcall
#define __int64 long long

// ---- Windows types used by declarations in var.h / extern.h ------------------
// The engine is compiled as C++14 on purpose: in C++17 "byte" would be
// ambiguous with std::byte because var.h / extern.h say "using namespace std;".
typedef unsigned char byte;
typedef long HRESULT;
#define CALLBACK
typedef const char *LPCTSTR;
typedef void *LPDEVMODEA;
typedef void *LPDEVMODE;
typedef void *HWND;
typedef void *LPVOID;
typedef void *PDISPLAY_DEVICE;
typedef unsigned long DWORD; // identical to the typedef in CODE4.CPP:72

// ---- Borland run-time library -----------------------------------------------
#ifdef __cplusplus
extern "C" {
#endif

// itoa(value, buf, 10): signed decimal.  ultoa(value, buf, radix): unsigned,
// radix 2..36, lower-case digits.  (CODE9.CPP tasks 3, 15, 17.)
char *itoa(int value, char *str, int radix);
char *ultoa(unsigned long value, char *str, int radix);

// ---- stdio redirection --------------------------------------------------------
// SIMOPS2.CPP opens host files with fopen() and deletes them with remove().
// Both are routed to the shim (shim/hostfile.cpp), which hands back a FILE*
// whose reads, writes and seeks go to the host object.  fread, fwrite, fseek,
// fclose, feof and fgets then work on that FILE* unchanged.
FILE *easy68k_fopen(const char *name, const char *mode);
int easy68k_remove(const char *name);

#ifdef __cplusplus
}
#endif

#define fopen easy68k_fopen
#define remove easy68k_remove

#endif
