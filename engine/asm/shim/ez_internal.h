/*
 * ez_internal.h - state shared by the shim's own translation units
 * (ez_file.cpp, ez_vcl.cpp, ez_host.cpp). Not used by the engine sources.
 *
 * Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.
 */
#ifndef EZ_INTERNAL_H
#define EZ_INTERNAL_H

#include "ez_vcl.h"
#include <string>

/* ---- virtual file system (ez_file.cpp) -------------------------------- */
struct EzNode {
  std::string key;                    /* canonical, upper-cased path */
  std::string name;                   /* name as given by the host or the engine */
  std::vector<unsigned char> data;    /* raw bytes as stored on "disk" */
  bool deleted;
};
extern std::vector<EzNode> ezNodes;

/* Canonical form of a Windows path, resolved against the current
   directory: "\DIR\FILE.X68" (virtual root) or "C:\DIR\FILE.X68".
   Returns false when Windows would reject the name. */
bool ezCanonicalPath(const char *name, std::string &out);
/* Current directory in canonical form, without trailing separator
   ("" = virtual root, "C:" = root of drive C). */
extern std::string ezCwd;
void ezSetCwdFromPath(const char *fileName);
int ezFindNode(const std::string &key);         /* -1 when absent */
int ezAddNode(const char *name, const unsigned char *data, int len);
void ezDeleteFile(const char *name);
int ezOpenFileCount();

/* ---- host-visible records (ez_vcl.cpp / ez_host.cpp) ------------------- */
struct EzDialog {
  std::string caption;
  std::string text;
};
extern std::vector<EzDialog> ezDialogs;
extern TDateTime ezNow;
extern int ezCurrentErrorCode;      /* code of the printError() call in progress */
extern bool ezExitCalled;

/* The one editor window of the port. */
extern TTextStuff ezActiveWindow;

#endif
