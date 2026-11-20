/*
 * ez_prelude.h - force-included in front of every translation unit of the
 * assembler engine (em++ "-include", cl "/FI").
 *
 * Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.
 *
 * What it does, in this order:
 *   1. Includes every system header the engine or the shim needs, BEFORE any
 *      of the redirections below exist, so that no system header is ever
 *      parsed with a redirected name.
 *   2. Replaces the <ctype.h> classification functions with deterministic
 *      ASCII versions (see "Character classification" below).
 *   3. Redirects the C stdio calls the engine makes (fopen, fgets, fprintf,
 *      ...) and the type FILE to the shim's in-memory file layer
 *      (ez_file.cpp), which implements Windows C-runtime text mode per file.
 *   4. Supplies the Borland run-time names the engine uses and the host does
 *      not have (stricmp, strcmpi, strnicmp, itoa) and traps exit().
 *
 * Nothing here changes the engine's logic; every behavioural decision taken
 * by the shim is listed in engine/asm/PATCHES.md, section "Shim decisions".
 */
#ifndef EZ_PRELUDE_H
#define EZ_PRELUDE_H

#if defined(_MSC_VER)
/* The native twin is built with MSVC; silence its "unsafe CRT" notes. */
#ifndef _CRT_SECURE_NO_WARNINGS
#define _CRT_SECURE_NO_WARNINGS 1
#endif
#ifndef _CRT_NONSTDC_NO_WARNINGS
#define _CRT_NONSTDC_NO_WARNINGS 1
#endif
#endif

/* ---- 1. system headers (all of them, before any redirection) ---------- */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <stdarg.h>
#include <stddef.h>
#include <limits.h>
#include <malloc.h>
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif
#ifdef __cplusplus
#include <new>
#include <vector>
#include <string>
#endif

#ifdef __cplusplus

/* ---- 2. Character classification -------------------------------------
 * The engine passes plain (signed) char values to <ctype.h>; bytes >= 0x80
 * arrive as negative numbers. Borland indexes a table with them (reading
 * outside the table: the result is not knowable from the sources), MSVC
 * asserts or reads out of bounds, musl answers "no". The shim fixes one
 * deterministic answer for every build: only the 7-bit ASCII classes of
 * the "C" locale exist, every other value (negative or >= 0x80) is in no
 * class, and toupper() leaves it unchanged. This is musl's behaviour and
 * was the [EXP] behaviour recorded in docs/porting/assembler.md 9.2. */
inline int ez_isspace(int c)  { return c == ' ' || (c >= '\t' && c <= '\r'); }
inline int ez_isdigit(int c)  { return c >= '0' && c <= '9'; }
inline int ez_isupper(int c)  { return c >= 'A' && c <= 'Z'; }
inline int ez_islower(int c)  { return c >= 'a' && c <= 'z'; }
inline int ez_isalpha(int c)  { return ez_isupper(c) || ez_islower(c); }
inline int ez_isalnum(int c)  { return ez_isalpha(c) || ez_isdigit(c); }
inline int ez_isxdigit(int c) { return ez_isdigit(c) || (c >= 'A' && c <= 'F') || (c >= 'a' && c <= 'f'); }
inline int ez_toupper(int c)  { return ez_islower(c) ? c - 'a' + 'A' : c; }
inline int ez_tolower(int c)  { return ez_isupper(c) ? c - 'A' + 'a' : c; }

#undef isspace
#undef isdigit
#undef isupper
#undef islower
#undef isalpha
#undef isalnum
#undef isxdigit
#undef toupper
#undef tolower
#define isspace(c)  ez_isspace(c)
#define isdigit(c)  ez_isdigit(c)
#define isupper(c)  ez_isupper(c)
#define islower(c)  ez_islower(c)
#define isalpha(c)  ez_isalpha(c)
#define isalnum(c)  ez_isalnum(c)
#define isxdigit(c) ez_isxdigit(c)
#define toupper(c)  ez_toupper(c)
#define tolower(c)  ez_tolower(c)

/* ---- Fault emulation --------------------------------------------------
 * Borland C++Builder turns CPU faults (access violation, integer divide
 * error) into exceptions that the engine's catch(...) handlers catch.
 * WebAssembly cannot do that, so the places where the original faults in a
 * way whose outcome is known are made to throw this object instead (see
 * PATCHES.md). Only catch(...) ever sees it. */
struct EzCpuFault { int kind; };
enum { EZ_FAULT_ACCESS = 1, EZ_FAULT_DIVIDE = 2 };
void ez_fault(int kind);                    /* always throws EzCpuFault */
/* Used by the marked patches in the engine sources. */
#define EZ_FAULT_IF_NULL(ptr)  do { if ((ptr) == 0) ez_fault(EZ_FAULT_ACCESS); } while (0)

/* ---- 3. stdio redirection to the in-memory file layer ----------------- */
struct EzFile;                              /* defined in ez_file.cpp */
EzFile *ez_fopen(const char *name, const char *mode);
int     ez_fclose(EzFile *f);
char   *ez_fgets(char *buf, int n, EzFile *f);
int     ez_fputs(const char *s, EzFile *f);
int     ez_fputc(int c, EzFile *f);
int     ez_fprintf(EzFile *f, const char *fmt, ...);
size_t  ez_fread(void *buf, size_t size, size_t count, EzFile *f);
size_t  ez_fwrite(const void *buf, size_t size, size_t count, EzFile *f);
int     ez_feof(EzFile *f);
int     ez_ferror(EzFile *f);
int     ez_fseek(EzFile *f, long offset, int whence);
long    ez_ftell(EzFile *f);
void    ez_rewind(EzFile *f);
/* sprintf with a fault on a NULL destination (Borland: access violation,
   caught by the nearest catch(...); see listCond() in PATCHES.md). */
int     ez_sprintf(char *dst, const char *fmt, ...);

#undef FILE
#define FILE EzFile
#undef fopen
#undef fclose
#undef fgets
#undef fputs
#undef fputc
#undef putc
#undef fprintf
#undef fread
#undef fwrite
#undef feof
#undef ferror
#undef fseek
#undef ftell
#undef rewind
#undef sprintf
#define fopen   ez_fopen
#define fclose  ez_fclose
#define fgets   ez_fgets
#define fputs   ez_fputs
#define fputc   ez_fputc
#define putc    ez_fputc
#define fprintf ez_fprintf
#define fread   ez_fread
#define fwrite  ez_fwrite
#define feof    ez_feof
#define ferror  ez_ferror
#define fseek   ez_fseek
#define ftell   ez_ftell
#define rewind  ez_rewind
#define sprintf ez_sprintf

/* ---- 4. Borland run-time names ---------------------------------------- */
int   ez_stricmp(const char *a, const char *b);
int   ez_strnicmp(const char *a, const char *b, size_t n);
char *ez_itoa(int value, char *buf, int radix);
#undef stricmp
#undef strcmpi
#undef strnicmp
#undef itoa
#define stricmp  ez_stricmp
#define strcmpi  ez_stricmp
#define strnicmp ez_strnicmp
#define itoa     ez_itoa

/* exit() is reached only from effAddr() with a corrupt instruction table
   (CODEGEN.CPP:121). The original then ends the editor process; the port
   ends the assembly and reports it to the host as a fatal error. */
#if defined(_MSC_VER)
__declspec(noreturn) void ez_exit(int status);
#else
void ez_exit(int status) __attribute__((noreturn));
#endif
#undef exit
#define exit(status) ez_exit(status)

#endif /* __cplusplus */
#endif /* EZ_PRELUDE_H */
