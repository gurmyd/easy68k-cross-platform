// native-prelude.h - force-included (cl /FI) in front of every C++ file of the simulator twin.
//
// The simulator engine is written for Clang (Emscripten). This header adds the little that MSVC
// lacks and then includes the engine's own prelude (engine/sim/shim/prelude.h), so that the
// original files and the engine's shim compile unchanged:
//
//   * __attribute__((unused)) in shim/regblock.h is a GCC/Clang spelling; it only silences a
//     warning, so it is defined away here.
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

// fclose() of the engine goes through the twin (sim-twin/hostfile-native.cpp), which keeps track of
// the open program files so that, as on the WebAssembly side, a file is open in at most one stream.
extern "C" int twin_fclose(FILE *stream);
#define fclose twin_fclose

#endif
