// easy68k-mac: the original sources include this header both as "proto.h"
// (var.h, extern.h) and as "PROTO.H" (UTILS.CPP); the file is PROTO.H.  This
// forwarder makes the lower-case spelling work on case-sensitive file systems.
// (On a case-insensitive file system it is never reached: the compiler finds
// src/PROTO.H next to the including file first.)
#ifndef EASY68K_PROTO_FORWARD
#define EASY68K_PROTO_FORWARD
#include "PROTO.H"
#endif
