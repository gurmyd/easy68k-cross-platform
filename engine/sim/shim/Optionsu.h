// easy68k-mac: stand-in for the original Optionsu.h (the Auto Trace Options
// dialog).  scrshow() reads one check box from it: "Disable display update".
#ifndef EASY68K_OPTIONSU_H
#define EASY68K_OPTIONSU_H

#include "vcl.h"

class TAutoTraceOptions {
public:
  TAutoTraceOptions();
  TCheckBox *DisableDisplay;
};

extern TAutoTraceOptions *AutoTraceOptions;

#endif
