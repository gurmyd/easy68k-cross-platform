// Stand-in for <emscripten/emscripten.h> in the native simulator twin (MSVC). engine/sim/shim/api.cpp
// uses only EMSCRIPTEN_KEEPALIVE, which marks a function as exported from the WebAssembly module;
// in a native program the functions are simply called by the twin's driver.
//
// Part of easy68k-cross-platform, an unofficial port of EASy68K. GPL-2.0-or-later.
#ifndef EASY68K_NATIVE_EMSCRIPTEN_H
#define EASY68K_NATIVE_EMSCRIPTEN_H
#define EMSCRIPTEN_KEEPALIVE
#endif
