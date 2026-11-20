// easy68k-mac: RUN.CPP includes "opcodes.h"; the file is OPCODES.H.  This
// forwarder makes that work on case-sensitive file systems.  OPCODES.H defines
// data and must be included by RUN.CPP only.
#ifndef EASY68K_OPCODES_FORWARD
#define EASY68K_OPCODES_FORWARD
#include "OPCODES.H"
#endif
