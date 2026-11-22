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
// Both are routed to the shim (shim/hostfile.cpp): fopen hands back a FILE*
// that is either a stream of the modelled Borland run-time (the 68000
// program's files) or a C library stream (loadSrec's "rt").
FILE *easy68k_fopen(const char *name, const char *mode);
int easy68k_remove(const char *name);

// fread(), fwrite(), fseek(), fclose() and feof() on the files of the 68000
// program are those of the Borland run-time library linked into SIM68K.exe,
// modelled in shim/hostfile.cpp (shim/STDIO-MODEL.md); on any other FILE* they
// are the C library's.  Function-like macros, so that the shim can still
// reach the C library's own functions as (fread) etc.
size_t easy68k_fread(void *buffer, size_t size, size_t count, FILE *stream);
size_t easy68k_fwrite(const void *buffer, size_t size, size_t count, FILE *stream);
int easy68k_fseek(FILE *stream, long offset, int whence);
int easy68k_fclose(FILE *stream);
int easy68k_feof(FILE *stream);

#ifdef __cplusplus
}
#endif

#define fopen easy68k_fopen
#define remove easy68k_remove
#define fread(buffer, size, count, stream) easy68k_fread(buffer, size, count, stream)
#define fwrite(buffer, size, count, stream) easy68k_fwrite(buffer, size, count, stream)
#undef fseek
#undef fclose
#undef feof
#define fseek(stream, offset, whence) easy68k_fseek(stream, offset, whence)
#define fclose(stream) easy68k_fclose(stream)
#define feof(stream) easy68k_feof(stream)

#endif
