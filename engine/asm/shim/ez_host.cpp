/*
 * ez_host.cpp - host glue: the C interface that the JavaScript wrapper
 * (asm68k.mjs) and the native test driver (native/driver.cpp) call.
 *
 * Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.
 *
 * One assembly per process / per WebAssembly instance:
 *   ez_fs_add(...)        once per input file (INCLUDE / INCBIN candidates)
 *   ez_set_options(...)   the eight option flags plus tab type and size
 *   ez_set_time(...)      the time printed on the "Created On:" line
 *   ez_assemble(...)      what TMain::mnuDoAssemblerClick (mainS.cpp:342-392) does
 *   ez_msg_* / ez_dialog_* / ez_fs_* / counts   read the results
 */
#include "ez_internal.h"
#include "ez_api.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

/* ---- engine globals (GLOBALS.CPP) and entry point (ASSEMBLE.CPP) -------- */
extern bool listFlag, objFlag, CEXflag, BITflag, CREflag, MEXflag, SEXflag, WARflag;
extern int errorCount, warningCount;
int assembleFile(char fileName[], char tempName[], AnsiString workName);

/* ---- printError() wrapper ------------------------------------------------
 * ERROR.CPP is compiled with -DprintError=ez_original_printError, so every
 * call the engine makes lands here first. The wrapper only remembers the
 * status code, so that the message row that printError() adds to the
 * message list can carry its severity; it changes nothing else. */
int ez_original_printError(FILE *outFile, int errorCode, int lineNum);

int printError(FILE *outFile, int errorCode, int lineNum)
{
  int saved = ezCurrentErrorCode;
  ezCurrentErrorCode = errorCode;
  int r = ez_original_printError(outFile, errorCode, lineNum);
  ezCurrentErrorCode = saved;
  return r;
}

/* ---- heap: zero-filled -----------------------------------------------------
 * The engine reads fields of a freshly allocated symbol that it has not
 * written (SYMBOL.CPP:152-169 with SYMBOL.CPP:245, see PATCHES.md). The
 * Borland heap content there is not knowable; the port makes every
 * allocation zero-filled so the result is at least deterministic. */
#if defined(__clang__)
#pragma clang diagnostic ignored "-Wwasm-exception-spec"
#endif
#if __cplusplus >= 201103L || defined(_MSC_VER)
#define EZ_NEW_THROW
#define EZ_NOTHROW noexcept
#else
#define EZ_NEW_THROW throw(std::bad_alloc)
#define EZ_NOTHROW throw()
#endif
void *operator new(size_t n) EZ_NEW_THROW
{
  void *p = calloc(1, n ? n : 1);
  if (!p)
    throw std::bad_alloc();
  return p;
}
void *operator new[](size_t n) EZ_NEW_THROW
{
  void *p = calloc(1, n ? n : 1);
  if (!p)
    throw std::bad_alloc();
  return p;
}
void operator delete(void *p) EZ_NOTHROW { free(p); }
void operator delete[](void *p) EZ_NOTHROW { free(p); }

/* ---- exit() ------------------------------------------------------------------ */
bool ezExitCalled = false;

void ez_exit(int status)
{
  (void)status;
  ezExitCalled = true;
  /* The original ends the editor process here (CODEGEN.CPP:121). Nothing
     after this point of the run is meaningful; abort the instance. The
     JavaScript wrapper turns the trap into a "fatal" result. */
  abort();
}

/* ---- state of this run ------------------------------------------------------- */
static std::string workNameStr;

static std::string normaliseWorkName(const char *name)
{
  std::string s(name ? name : "");
  for (size_t i = 0; i < s.size(); i++)
    if (s[i] == '/') s[i] = '\\';
  bool absolute = (s.size() >= 2 && s[1] == ':') || (!s.empty() && s[0] == '\\');
  if (!absolute)
    s = "\\" + s;
  return s;
}

extern "C" {

EZ_API int ez_fs_add(const char *name, const unsigned char *data, int len)
{
  return ezAddNode(name, data, len);
}

EZ_API void ez_set_options(int list, int obj, int cex, int bit, int cre,
                           int mex, int sex, int war, int tabType, int tabSize)
{
  /* mainS.cpp:360-367 copies the check boxes into the engine globals right
     before assembleFile(); assembleFile() reads chkGenList itself. */
  Options->chkGenList->Checked = list != 0;
  listFlag = list != 0;
  objFlag = obj != 0;
  CEXflag = cex != 0;
  BITflag = bit != 0;
  CREflag = cre != 0;
  MEXflag = mex != 0;
  SEXflag = sex != 0;
  WARflag = war != 0;
  ezActiveWindow.Project.TabType = tabType;
  ezActiveWindow.Project.TabSize = tabSize;
}

EZ_API void ez_set_time(int year, int month, int day, int hour, int minute, int second)
{
  ezNow.year = year;
  ezNow.month = month;
  ezNow.day = day;
  ezNow.hour = hour;
  ezNow.minute = minute;
  ezNow.second = second;
}

EZ_API int ez_assemble(const char *workName, const unsigned char *source, int len)
{
  workNameStr = normaliseWorkName(workName);
  AnsiString work(workNameStr.c_str());

  TTextStuff *Active = &ezActiveWindow;
  Main->ActiveMDIChild = Active;
  Active->Project.CurrentFile = work;
  Active->Messages->Items->Clear();                         /* mainS.cpp:355 */

  int result = 0;
  try {
    ezSetCwdFromPath(work.c_str());                         /* mainS.cpp:370 */
    AnsiString sourceFile = ExtractFilePath(work) + "EASy68Ks.tmp";
    AnsiString tempFile = ExtractFilePath(work) + "EASy68Km.tmp";
    /* mainS.cpp:373: Lines->SaveToFile(sourceFile). The host passes the
       editor text; TStrings::SaveToFile writes it as lines, each one - the
       last one included - followed by CR LF. A line break in the text is
       CR LF, a lone LF or a lone CR (TStrings / rich-edit paragraphs). */
    std::vector<unsigned char> saved;
    saved.reserve((size_t)(len > 0 ? len : 0) + 2);
    for (int i = 0; i < len; i++) {
      unsigned char c = source[i];
      if (c == '\r' || c == '\n') {
        saved.push_back('\r');
        saved.push_back('\n');
        if (c == '\r' && i + 1 < len && source[i + 1] == '\n')
          i++;
      } else
        saved.push_back(c);
    }
    if (!saved.empty() && saved[saved.size() - 1] != '\n') {
      saved.push_back('\r');
      saved.push_back('\n');
    }
    ezAddNode(sourceFile.c_str(), saved.empty() ? (const unsigned char *)"" : &saved[0], (int)saved.size());
    result = assembleFile(sourceFile.c_str(), tempFile.c_str(), work);
    ezDeleteFile(sourceFile.c_str());                       /* mainS.cpp:375-376 */
    ezDeleteFile(tempFile.c_str());
  } catch (...) {
    /* mainS.cpp:379-384 */
    Application->MessageBox("File Access Error.  Please verify that you have write "
                            "permission to the folder where the selected file is located.",
                            "Error", MB_OK);
    result = -1;
  }
  return result;
}

EZ_API int ez_error_count(void) { return errorCount; }
EZ_API int ez_warning_count(void) { return warningCount; }
EZ_API int ez_execute_enabled(void) { return AssemblerBox->cmdExecute->Enabled ? 1 : 0; }
EZ_API int ez_exit_called(void) { return ezExitCalled ? 1 : 0; }
EZ_API int ez_open_file_count(void) { return ezOpenFileCount(); }

/* ---- message list ------------------------------------------------------------ */
static TListItem *row(int i)
{
  std::vector<TListItem *> &r = ezActiveWindow.Messages->Items->rows;
  return (i >= 0 && i < (int)r.size()) ? r[(size_t)i] : 0;
}

EZ_API int ez_msg_count(void) { return (int)ezActiveWindow.Messages->Items->rows.size(); }
EZ_API int ez_msg_line(int i) { TListItem *it = row(i); return it ? atoi(it->Caption.c_str()) : 0; }
EZ_API const char *ez_msg_text(int i)
{
  TListItem *it = row(i);
  return (it && !it->SubItems->items.empty()) ? it->SubItems->items[0].c_str() : "";
}
EZ_API const char *ez_msg_file(int i) { TListItem *it = row(i); return it ? it->ezIncludeFile.c_str() : ""; }
EZ_API int ez_msg_code(int i) { TListItem *it = row(i); return it ? it->ezCode : 0; }
EZ_API int ez_msg_file_node(int i)
{
  /* the input file an include-file message belongs to, -1 for the main file */
  TListItem *it = row(i);
  if (!it || it->ezIncludeFile.IsEmpty())
    return -1;
  std::string key;
  if (!ezCanonicalPath(it->ezIncludeFile.c_str(), key))
    return -1;
  return ezFindNode(key);
}

/* ---- message boxes ------------------------------------------------------------ */
EZ_API int ez_dialog_count(void) { return (int)ezDialogs.size(); }
EZ_API const char *ez_dialog_caption(int i)
{
  return (i >= 0 && i < (int)ezDialogs.size()) ? ezDialogs[(size_t)i].caption.c_str() : "";
}
EZ_API const char *ez_dialog_text(int i)
{
  return (i >= 0 && i < (int)ezDialogs.size()) ? ezDialogs[(size_t)i].text.c_str() : "";
}

/* ---- files ---------------------------------------------------------------------- */
EZ_API int ez_fs_count(void) { return (int)ezNodes.size(); }
EZ_API int ez_fs_deleted(int i) { return (i >= 0 && i < (int)ezNodes.size() && ezNodes[(size_t)i].deleted) ? 1 : 0; }
EZ_API const char *ez_fs_name(int i) { return (i >= 0 && i < (int)ezNodes.size()) ? ezNodes[(size_t)i].name.c_str() : ""; }
EZ_API const char *ez_fs_key(int i) { return (i >= 0 && i < (int)ezNodes.size()) ? ezNodes[(size_t)i].key.c_str() : ""; }
EZ_API int ez_fs_size(int i) { return (i >= 0 && i < (int)ezNodes.size()) ? (int)ezNodes[(size_t)i].data.size() : 0; }
EZ_API const unsigned char *ez_fs_data(int i)
{
  if (i < 0 || i >= (int)ezNodes.size() || ezNodes[(size_t)i].data.empty())
    return 0;
  return &ezNodes[(size_t)i].data[0];
}
EZ_API int ez_fs_find(const char *name)
{
  std::string key;
  if (!ezCanonicalPath(name, key))
    return -1;
  return ezFindNode(key);
}

/* Index of the .L68 (which == 0) or .S68 (which == 1) written by the last
   ez_assemble(), or -1 when it was not created. */
EZ_API int ez_output_node(int which)
{
  AnsiString out = ChangeFileExt(AnsiString(workNameStr.c_str()), which ? ".S68" : ".L68");
  return ez_fs_find(out.c_str());
}

/* Scratch memory for the JavaScript side (bytes of names and files). */
EZ_API void *ez_alloc(int n) { return malloc((size_t)(n > 0 ? n : 1)); }
EZ_API void ez_free(void *p) { free(p); }

} /* extern "C" */
