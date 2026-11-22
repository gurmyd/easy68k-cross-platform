// native-prelude.h - force-included (cl /FI) in front of every C++ file of the simulator twin.
//
// The simulator engine is written for Clang (Emscripten). This header adds the little that MSVC
// lacks and then includes the engine's own prelude (engine/sim/shim/prelude.h), so that the
// original files and the engine's shim compile unchanged:
//
//   * __attribute__((unused)) in shim/regblock.h is a GCC/Clang spelling; it only silences a
//     warning, so it is defined away here.
//
//   * fopencookie(), which the engine's shim/hostfile.cpp needs (see below).
//
// Everything else the engine's build gets from Clang flags is either the MSVC default (signed
// plain char, no type-based alias analysis, Ctrl-Z ends a source file) or deliberately left out,
// because finding out whether a result depends on it is the purpose of the twin (README.md,
// "What the twin does not reproduce").
//
// Part of easy68k-cross-platform, an unofficial port of EASy68K. GPL-2.0-or-later.
#ifndef EASY68K_NATIVE_PRELUDE_H
#define EASY68K_NATIVE_PRELUDE_H

#ifndef __clang__
#define __attribute__(x)
#endif

#include "prelude.h"

#ifndef __clang__
#include <stdint.h>
// fopencookie() of glibc and musl, which the engine's shim/hostfile.cpp uses for loadSrec's "rt"
// stream and for the execution log, and which the Microsoft C library does not have:
// sim-twin/host-native.cpp provides it (twin_fopencookie), together with the fflush() that hands a
// write cookie its bytes (twin_fflush). Everything else of hostfile.cpp - the streams of the
// Borland run-time over the host's file interface - compiles and runs unchanged.
typedef intptr_t ssize_t;
typedef ssize_t cookie_read_function_t(void *cookie, char *buffer, size_t size);
typedef ssize_t cookie_write_function_t(void *cookie, const char *buffer, size_t size);
typedef int cookie_seek_function_t(void *cookie, long long *offset, int whence);
typedef int cookie_close_function_t(void *cookie);
typedef struct {
  cookie_read_function_t *read;
  cookie_write_function_t *write;
  cookie_seek_function_t *seek;
  cookie_close_function_t *close;
} cookie_io_functions_t;
#ifdef __cplusplus
extern "C" {
#endif
FILE *twin_fopencookie(void *cookie, const char *mode, cookie_io_functions_t io);
int twin_fflush(FILE *stream);
#ifdef __cplusplus
}
#endif
#define fopencookie twin_fopencookie
#undef fflush
#define fflush twin_fflush
#endif

#endif
