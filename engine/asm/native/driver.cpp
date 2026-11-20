/*
 * driver.cpp - command-line front end of the native twin of the assembler
 * engine (built with MSVC as a 32-bit program by native/build.mjs). It is a
 * test tool: it feeds files from disk into the same shim interface that the
 * WebAssembly build exposes (ez_api.h) and writes the results to disk.
 *
 * Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.
 *
 * Usage:
 *   ez68k-asm --manifest <file> --main <name> [options] [outputs]
 *
 *   --manifest <file>  text file, one input per line: <virtual name> TAB <path on disk>
 *   --main <name>      virtual name of the main source (must be in the manifest);
 *                      its bytes are used as the editor buffer
 *   --source <path>    take the editor buffer from this file instead
 *   --options LIST     eight 0/1 digits: list obj cex bit cre mex sex war
 *                      (default 11011001 = the original's shipped defaults)
 *   --tabs T,S         tab type (0 = Assembly, 1 = Fixed) and fixed size (default 1,4)
 *   --time Y,M,D,h,m,s time for the "Created On:" line (default 2000,1,1,0,0,0)
 *   --l68 <path>       write the listing there (if one was produced)
 *   --s68 <path>       write the S-record file there (if one was produced)
 *   --json <path>      write counts, message list and message boxes as JSON
 *
 * This file does NOT include the shim prelude: it uses the real C runtime.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <string>
#include <vector>
#ifdef _MSC_VER
#include <stdlib.h>
#include <crtdbg.h>
#endif
#include "../shim/ez_api.h"

static bool readFile(const char *path, std::vector<unsigned char> &out)
{
  FILE *f = fopen(path, "rb");
  if (!f)
    return false;
  unsigned char buf[65536];
  size_t n;
  out.clear();
  while ((n = fread(buf, 1, sizeof buf, f)) > 0)
    out.insert(out.end(), buf, buf + n);
  fclose(f);
  return true;
}

static bool writeFile(const char *path, const unsigned char *data, int len)
{
  FILE *f = fopen(path, "wb");
  if (!f)
    return false;
  if (len > 0)
    fwrite(data, 1, (size_t)len, f);
  fclose(f);
  return true;
}

/* JSON string of a byte string: bytes >= 0x80 as \u00XX (Latin-1 view). */
static void jsonString(FILE *f, const char *s)
{
  fputc('"', f);
  for (const unsigned char *p = (const unsigned char *)s; *p; p++) {
    if (*p == '"' || *p == '\\') fprintf(f, "\\%c", *p);
    else if (*p < 0x20 || *p >= 0x7F) fprintf(f, "\\u%04x", *p);
    else fputc(*p, f);
  }
  fputc('"', f);
}

#ifdef _MSC_VER
static void ignoreInvalidParameter(const wchar_t *, const wchar_t *, const wchar_t *, unsigned int, uintptr_t)
{
  /* An invalid printf format (unpatched build, fprintf with user text)
     makes the CRT call this; returning lets the call fail with -1. */
}
#endif

int main(int argc, char **argv)
{
#ifdef _MSC_VER
  _set_invalid_parameter_handler(ignoreInvalidParameter);
  _CrtSetReportMode(_CRT_ASSERT, 0);
#endif
  const char *manifest = 0, *mainName = 0, *sourcePath = 0;
  const char *l68 = 0, *s68 = 0, *json = 0;
  const char *opts = "11011001";
  int tabType = 1, tabSize = 4;
  int t[6] = { 2000, 1, 1, 0, 0, 0 };

  for (int i = 1; i < argc; i++) {
    const char *a = argv[i];
    const char *v = i + 1 < argc ? argv[i + 1] : 0;
    if (!strcmp(a, "--manifest") && v) { manifest = v; i++; }
    else if (!strcmp(a, "--main") && v) { mainName = v; i++; }
    else if (!strcmp(a, "--source") && v) { sourcePath = v; i++; }
    else if (!strcmp(a, "--options") && v) { opts = v; i++; }
    else if (!strcmp(a, "--tabs") && v) { sscanf(v, "%d,%d", &tabType, &tabSize); i++; }
    else if (!strcmp(a, "--time") && v) { sscanf(v, "%d,%d,%d,%d,%d,%d", &t[0], &t[1], &t[2], &t[3], &t[4], &t[5]); i++; }
    else if (!strcmp(a, "--l68") && v) { l68 = v; i++; }
    else if (!strcmp(a, "--s68") && v) { s68 = v; i++; }
    else if (!strcmp(a, "--json") && v) { json = v; i++; }
    else { fprintf(stderr, "unknown argument: %s\n", a); return 2; }
  }
  if (!manifest || !mainName || strlen(opts) != 8) {
    fprintf(stderr, "usage: ez68k-asm --manifest <file> --main <name> [--source <path>] [--options 11011001]\n"
                    "                 [--tabs 1,4] [--time 2000,1,1,0,0,0] [--l68 p] [--s68 p] [--json p]\n");
    return 2;
  }

  /* inputs */
  std::vector<unsigned char> man;
  if (!readFile(manifest, man)) { fprintf(stderr, "cannot read %s\n", manifest); return 2; }
  man.push_back('\n');
  std::string lineBuf;
  std::vector<unsigned char> source;
  bool haveSource = false;
  for (size_t i = 0; i < man.size(); i++) {
    char c = (char)man[i];
    if (c != '\n') { if (c != '\r') lineBuf += c; continue; }
    if (!lineBuf.empty()) {
      size_t tab = lineBuf.find('\t');
      if (tab == std::string::npos) { fprintf(stderr, "bad manifest line: %s\n", lineBuf.c_str()); return 2; }
      std::string name = lineBuf.substr(0, tab), path = lineBuf.substr(tab + 1);
      std::vector<unsigned char> data;
      if (!readFile(path.c_str(), data)) { fprintf(stderr, "cannot read %s\n", path.c_str()); return 2; }
      ez_fs_add(name.c_str(), data.empty() ? (const unsigned char *)"" : &data[0], (int)data.size());
      if (name == mainName) { source = data; haveSource = true; }
    }
    lineBuf.clear();
  }
  if (sourcePath) {
    if (!readFile(sourcePath, source)) { fprintf(stderr, "cannot read %s\n", sourcePath); return 2; }
    haveSource = true;
  }
  if (!haveSource) { fprintf(stderr, "main source %s not in manifest\n", mainName); return 2; }

  int o[8];
  for (int i = 0; i < 8; i++) o[i] = opts[i] == '1';
  ez_set_options(o[0], o[1], o[2], o[3], o[4], o[5], o[6], o[7], tabType, tabSize);
  ez_set_time(t[0], t[1], t[2], t[3], t[4], t[5]);

  int status = ez_assemble(mainName, source.empty() ? (const unsigned char *)"" : &source[0], (int)source.size());

  /* outputs */
  int nl = ez_output_node(0), ns = ez_output_node(1);
  if (l68) { if (nl >= 0) writeFile(l68, ez_fs_data(nl), ez_fs_size(nl)); else remove(l68); }
  if (s68) { if (ns >= 0) writeFile(s68, ez_fs_data(ns), ez_fs_size(ns)); else remove(s68); }
  if (json) {
    FILE *f = fopen(json, "wb");
    if (!f) { fprintf(stderr, "cannot write %s\n", json); return 2; }
    fprintf(f, "{\"status\":%d,\"errorCount\":%d,\"warningCount\":%d,\"executeEnabled\":%s,"
               "\"openFiles\":%d,\"listing\":%s,\"sRecord\":%s,\"messages\":[",
            status, ez_error_count(), ez_warning_count(), ez_execute_enabled() ? "true" : "false",
            ez_open_file_count(), nl >= 0 ? "true" : "false", ns >= 0 ? "true" : "false");
    for (int i = 0; i < ez_msg_count(); i++) {
      fprintf(f, "%s{\"line\":%d,\"code\":%d,\"text\":", i ? "," : "", ez_msg_line(i), ez_msg_code(i));
      jsonString(f, ez_msg_text(i));
      fprintf(f, ",\"file\":");
      jsonString(f, ez_msg_file(i));
      int node = ez_msg_file_node(i);
      fprintf(f, ",\"resolvedFile\":");
      if (node >= 0) jsonString(f, ez_fs_name(node)); else fprintf(f, "null");
      fprintf(f, "}");
    }
    fprintf(f, "],\"dialogs\":[");
    for (int i = 0; i < ez_dialog_count(); i++) {
      fprintf(f, "%s{\"caption\":", i ? "," : "");
      jsonString(f, ez_dialog_caption(i));
      fprintf(f, ",\"text\":");
      jsonString(f, ez_dialog_text(i));
      fprintf(f, "}");
    }
    fprintf(f, "]}\n");
    fclose(f);
  }
  return 0;
}
