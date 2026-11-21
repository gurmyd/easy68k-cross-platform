/*
 * driver.cpp - the simulator twin: the patched simulator core (engine/sim/src) and the engine's
 * shim (engine/sim/shim) built natively with MSVC as a 32-bit program, with a headless host and a
 * small script language. It is a test tool (ARCHITECTURE.md 6.2.1): sim-script.mjs runs the same
 * scripts through the WebAssembly engine, and the two transcripts must be identical.
 *
 * Part of easy68k-mac, an unofficial port of EASy68K. GPL-2.0-or-later.
 *
 * Usage:
 *   sim-twin --script <file> --sandbox <dir> --work <dir> [--out <file>]
 *
 *   --script   the script (format below and in README.md); relative paths in it are relative to
 *              the script's folder
 *   --sandbox  folder of the 68000 program's files (TRAP #15 tasks 50-59); must exist
 *   --work     folder for temporary files and the execution log; must exist
 *   --out      write the transcript there instead of to standard output
 *
 * The host records every call the engine makes (except the file calls, which go to real files
 * here) as a line "@name arguments", in the names and argument forms of the JavaScript SimHost
 * (engine/sim/sim68k.mjs), and answers as the JavaScript defaults do (HOST_DEFAULTS): register
 * results are left unchanged, the window size is 640 x 480, everything else returns 0.
 *
 * This file does NOT include the engine's prelude: it uses the real C run-time library.
 */
#include <io.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <string>
#include <vector>
#include <deque>
#include <algorithm>
#include <crtdbg.h>
#include "api.h"
#include "host.h"
#include "twin.h"

static FILE *out = NULL;
static bool hostLog = true;
static unsigned timeValue = 0;
static std::deque<unsigned char> keys;
struct DialogReply {
  bool accepted;
  std::string name;
};
static std::deque<DialogReply> dialogReplies;
static std::string sandboxDir;

// ---------------------------------------------------------------------------
// transcript helpers
// ---------------------------------------------------------------------------
static void escaped(std::string &s, const unsigned char *p, size_t n) {
  char hex[8];
  s += '"';
  for (size_t i = 0; i < n; i++) {
    unsigned char c = p[i];
    if (c >= 0x20 && c < 0x7F && c != '"' && c != '\\') s += (char)c;
    else {
      sprintf(hex, "\\x%02X", c);
      s += hex;
    }
  }
  s += '"';
}

enum { LONG_BYTES = 512 };

/* CRC-32 (IEEE 802.3, as zlib). */
static unsigned crc32(const unsigned char *p, size_t n, unsigned crc = 0) {
  static unsigned table[256];
  if (!table[1]) {
    for (unsigned k = 0; k < 256; k++) {
      unsigned c = k;
      for (int j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
      table[k] = c;
    }
  }
  crc = ~crc;
  for (size_t i = 0; i < n; i++) crc = table[(crc ^ p[i]) & 0xFF] ^ (crc >> 8);
  return ~crc;
}

static void line(const std::string &s) {
  fwrite(s.data(), 1, s.size(), out);
  fputc('\n', out);
}

struct Call {
  std::string s;
  explicit Call(const char *name) : s("@") { s += name; }
  Call &i(long v) { char b[24]; sprintf(b, " %ld", v); s += b; return *this; }
  Call &u(unsigned long v) { char b[24]; sprintf(b, " %lu", v); s += b; return *this; }
  Call &b(int v) { s += v ? " 1" : " 0"; return *this; }
  // Up to LONG_BYTES bytes are written out; a longer argument (a string that ran through memory
  // full of $FF) as "#<length>:<CRC-32>", so that a transcript stays small.
  Call &bytes(const char *p, int n) {
    size_t len = n > 0 ? (size_t)n : 0;
    s += ' ';
    if (len <= LONG_BYTES) escaped(s, (const unsigned char *)p, len);
    else {
      char b[40];
      sprintf(b, "#%u:%08X", (unsigned)len, crc32((const unsigned char *)p, len));
      s += b;
    }
    return *this;
  }
  Call &str(const char *p) { return bytes(p, (int)strlen(p)); }
  ~Call() { if (hostLog) line(s); }
};

static unsigned memAddress(const void *p) { return (unsigned)((const unsigned char *)p - sim_memory()); }

// ---------------------------------------------------------------------------
// the host (shim/host.h)
// ---------------------------------------------------------------------------
extern "C" {
void host_message(const char *text, int length) { Call("message").bytes(text, length); }
void host_messages_clear(void) { Call("messagesClear"); }
void host_alert(const char *title, const char *text) { Call("alert").str(title).str(text); }
void host_show_regs(void) { Call("registersShown"); }
void host_menu_state(int state) { Call("menuState").i(state); }
void host_focus_main(void) { Call("focusMain"); }
void host_autotrace_timer(int enabled) { Call("autoTraceTimer").b(enabled); }
void host_key_commands(int enabled) { Call("keyCommands").b(enabled); }
void host_option_changed(int option, int value) { Call("optionChanged").i(option).i(value); }
void host_save_settings(void) { Call("saveSettings"); }
void host_caption(const char *text, int length) { Call("caption").bytes(text, length); }
void host_repaint(int what) { Call("repaint").i(what); }
void host_mem_live_paint(unsigned addr) { Call("memoryLivePaint").u(addr); }
void host_font_assign(int target, int source) { Call("fontAssign").i(target).i(source); }

void host_hw_update(void) { Call("hardwareUpdate"); }
void host_hw_state(int hardwareEnabled, int autoIRQ) { Call("hardwareState").b(hardwareEnabled).b(autoIRQ); }
void host_hw_timer(int level, int enabled, unsigned intervalMs) { Call("hardwareTimer").i(level).b(enabled).u(intervalMs); }
void host_hw_show(void) { Call("hardwareShow"); }
void host_hw_controls(void) { Call("hardwareControls"); }

void host_log_write(const char *, int) {} // not used: the twin's execution log is a real file
void host_log_state(int logging) { Call("logState").b(logging); }
void host_output_log_write(const char *data, int length) { Call("outputLogWrite").bytes(data, length); }

unsigned host_time_centiseconds(void) { Call("timeCentiseconds"); return timeValue; }

// The program's files are real files here (hostfile-native.cpp); these are never called.
int host_file_open(const char *, int) { return 0; }
int host_file_read(int, char *, int) { return -1; }
int host_file_write(int, const char *, int) { return -1; }
int host_file_seek(int, int, int) { return -1; }
int host_file_close(int) { return -1; }
int host_file_remove(const char *) { return -1; }
void host_file_dialog(int mode, const char *title, const char *filter, const char *fileName) {
  Call("fileDialog").i(mode).str(title).str(filter).str(fileName);
}

void host_io_charOut(int ch) { Call("charOut").i(ch & 0xFF); }
void host_io_textOut(const char *text, int length) { Call("textOut").bytes(text, length); }
void host_io_textOutCR(const char *text, int length) { Call("textOutCR").bytes(text, length); }
void host_io_clear(void) { Call("clear"); }
void host_io_getrc(short *) { Call("getrc"); }
void host_io_gotorc(int row, int col) { Call("gotorc").i(row).i(col); }
void host_io_setFontProperties(int color, int style) { Call("setFontProperties").i(color).i(style); }
void host_io_getCharAt(int row, int col, char *) { Call("getCharAt").i(row).i(col); }
void host_io_scrollRect(int row, int col, int height, int width, int direction) {
  Call("scrollRect").i(row).i(col).i(height).i(width).i(direction);
}
void host_io_setWindowSize(int width, int height) { Call("setWindowSize").i(width).i(height); }
void host_io_getWindowSize(unsigned short *width, unsigned short *height) {
  Call("getWindowSize");
  *width = 640;
  *height = 480;
}
void host_io_setupWindow(int fullScreen) { Call("setupWindow").b(fullScreen); }
void host_io_show(void) { Call("ioShow"); }
void host_io_bringToFront(void) { Call("ioBringToFront"); }
void host_io_prompt(int mode) { Call("inputPrompt").i(mode); }
void host_io_erasePrompt(void) { Call("erasePrompt"); }
void host_io_inputEcho(int ch, int echo) { Call("inputEcho").i(ch & 0xFF).b(echo); }
void host_io_inputBackspace(int echo) { Call("inputBackspace").b(echo); }
void host_io_doCRLF(void) { Call("doCRLF"); }
void host_io_invalidate(void) { Call("invalidate"); }

void host_io_setLineColor(int color) { Call("setLineColor").i(color); }
void host_io_setFillColor(int color) { Call("setFillColor").i(color); }
void host_io_drawPixel(int x, int y) { Call("drawPixel").i(x).i(y); }
int host_io_getPixel(int x, int y) { Call("getPixel").i(x).i(y); return 0; }
void host_io_line(int x1, int y1, int x2, int y2) { Call("line").i(x1).i(y1).i(x2).i(y2); }
void host_io_lineTo(int x, int y) { Call("lineTo").i(x).i(y); }
void host_io_moveTo(int x, int y) { Call("moveTo").i(x).i(y); }
void host_io_rectangle(int x1, int y1, int x2, int y2) { Call("rectangle").i(x1).i(y1).i(x2).i(y2); }
void host_io_ellipse(int x1, int y1, int x2, int y2) { Call("ellipse").i(x1).i(y1).i(x2).i(y2); }
void host_io_floodFill(int x, int y) { Call("floodFill").i(x).i(y); }
void host_io_unfilledRectangle(int x1, int y1, int x2, int y2) { Call("unfilledRectangle").i(x1).i(y1).i(x2).i(y2); }
void host_io_unfilledEllipse(int x1, int y1, int x2, int y2) { Call("unfilledEllipse").i(x1).i(y1).i(x2).i(y2); }
void host_io_setDrawingMode(int mode) { Call("setDrawingMode").i(mode); }
void host_io_setPenWidth(int width) { Call("setPenWidth").i(width); }
void host_io_formPaint(void) { Call("formPaint"); }
void host_io_drawText(const char *text, int length, int x, int y) { Call("drawText").bytes(text, length).i(x).i(y); }
void host_io_getXY(short *, short *) { Call("getXY"); }

void host_io_resetSounds(void) { Call("resetSounds"); }
void host_io_playSound(const char *fileName, short *) { Call("playSound").str(fileName); }
void host_io_loadSound(const char *fileName, int waveIndex) { Call("loadSound").str(fileName).i(waveIndex); }
void host_io_playSoundMem(int waveIndex, short *) { Call("playSoundMem").i(waveIndex); }
void host_io_controlSound(int control, int waveIndex, short *) { Call("controlSound").i(control).i(waveIndex); }
void host_io_playSoundDX(const char *fileName, short *) { Call("playSoundDX").str(fileName); }
void host_io_loadSoundDX(const char *fileName, int waveIndex, short *) { Call("loadSoundDX").str(fileName).i(waveIndex); }
void host_io_playSoundMemDX(int waveIndex, short *) { Call("playSoundMemDX").i(waveIndex); }
void host_io_controlSoundDX(int control, int waveIndex, short *) { Call("controlSoundDX").i(control).i(waveIndex); }

void host_io_initComm(int cid, const char *portName, short *) { Call("initComm").i(cid).str(portName); }
void host_io_setCommParams(int cid, int settings, short *) { Call("setCommParams").i(cid).i(settings); }
int host_io_commRead(int cid, char *, int n) { Call("commRead").i(cid).i(n); return -3; }
void host_io_sendComm(int cid, unsigned char *n, const char *data, short *) { Call("sendComm").i(cid).bytes(data, *n); }

void host_io_createNetClient(int settings, const char *server, int *) {
  Call("createNetClient").i(settings).str(server).u(memAddress(server));
}
void host_io_createNetServer(int settings, int *) { Call("createNetServer").i(settings); }
void host_io_sendNet(int settings, const char *data, const char *remoteIP, int *, int *) {
  Call("sendNet").i(settings).u(memAddress(data)).str(remoteIP);
}
void host_io_receiveNet(int settings, char *buffer, int *, char *senderIP, int *) {
  Call("receiveNet").i(settings).u(memAddress(buffer)).u(memAddress(senderIP));
}
void host_io_sendPortNet(long *, long *d1, const char *data, const char *remoteIP) {
  Call("sendPortNet").i(*d1).u(memAddress(data)).str(remoteIP);
}
void host_io_receivePortNet(long *, long *d1, char *buffer, char *senderIP) {
  Call("receivePortNet").i(*d1).u(memAddress(buffer)).u(memAddress(senderIP));
}
void host_io_closeNetConnection(int closeIP, int *) { Call("closeNetConnection").i(closeIP); }
void host_io_getLocalIP(char *localIP, int *) { Call("getLocalIP").u(memAddress(localIP)); }
int host_net_closeSockets(void) { Call("netCloseSockets"); return 0; }

void host_prn_beginDoc(void) { Call("printerBeginDoc"); }
void host_prn_endDoc(void) { Call("printerEndDoc"); }
int host_prn_metric(int which) { Call("printerMetric").i(which); return 0; }
void host_prn_textOut(int x, int y, int ch) { Call("printerTextOut").i(x).i(y).i(ch & 0xFF); }
}

// ---------------------------------------------------------------------------
// script parsing
// ---------------------------------------------------------------------------
static std::string scriptDir;
static int lineNumber = 0;

static void fail(const char *what, const std::string &detail = "") {
  fprintf(stderr, "script line %d: %s%s%s\n", lineNumber, what, detail.empty() ? "" : ": ", detail.c_str());
  exit(2);
}

struct Token {
  std::string text;
  bool quoted;
};

static int hexDigit(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static std::vector<Token> tokenize(const std::string &s) {
  std::vector<Token> tokens;
  size_t i = 0;
  while (i < s.size()) {
    if (s[i] == ' ' || s[i] == '\t') { i++; continue; }
    Token t;
    t.quoted = s[i] == '"';
    if (t.quoted) {
      i++;
      for (;;) {
        if (i >= s.size()) fail("unterminated string");
        char c = s[i++];
        if (c == '"') break;
        if (c != '\\') { t.text += c; continue; }
        if (i >= s.size()) fail("bad escape");
        char e = s[i++];
        if (e == 'r') t.text += '\r';
        else if (e == 'n') t.text += '\n';
        else if (e == 't') t.text += '\t';
        else if (e == '\\' || e == '"') t.text += e;
        else if (e == 'x' && i + 1 < s.size() && hexDigit(s[i]) >= 0 && hexDigit(s[i + 1]) >= 0) {
          t.text += (char)(hexDigit(s[i]) * 16 + hexDigit(s[i + 1]));
          i += 2;
        } else fail("bad escape");
      }
    } else {
      while (i < s.size() && s[i] != ' ' && s[i] != '\t') t.text += s[i++];
    }
    tokens.push_back(t);
  }
  return tokens;
}

/* A number: $hex, 0xhex, or decimal, optionally negative; wraps to 32 bits. */
static long number(const Token &t) {
  const std::string &s = t.text;
  size_t i = 0;
  bool negative = false;
  if (i < s.size() && s[i] == '-') { negative = true; i++; }
  int base = 10;
  if (i < s.size() && s[i] == '$') { base = 16; i++; }
  else if (i + 1 < s.size() && s[i] == '0' && (s[i + 1] == 'x' || s[i + 1] == 'X')) { base = 16; i += 2; }
  if (i >= s.size()) fail("bad number", s);
  unsigned long v = 0;
  for (; i < s.size(); i++) {
    int d = hexDigit(s[i]);
    if (d < 0 || d >= base) fail("bad number", s);
    v = v * base + d;
  }
  return (long)(negative ? 0 - v : v);
}

static std::string resolvePath(const std::string &p) {
  if (p.size() > 1 && (p[1] == ':' || p[0] == '\\' || p[0] == '/')) return p;
  return scriptDir + p;
}

static bool readFile(const std::string &path, std::vector<unsigned char> &data) {
  FILE *f = fopen(path.c_str(), "rb");
  if (!f) return false;
  unsigned char buf[65536];
  size_t n;
  data.clear();
  while ((n = fread(buf, 1, sizeof buf, f)) > 0) data.insert(data.end(), buf, buf + n);
  fclose(f);
  return true;
}

static std::string baseName(const std::string &p) {
  size_t k = p.find_last_of("\\/");
  return k == std::string::npos ? p : p.substr(k + 1);
}

static int registerNumber(const std::string &name) {
  static const char *names[] = {"D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "A0", "A1",
                                "A2", "A3", "A4", "A5", "A6", "USP", "SSP", "PC", "SR", "A7"};
  for (int r = 0; r < 20; r++)
    if (name == names[r]) return r;
  fail("unknown register", name);
  return -1;
}

static int optionNumber(const std::string &name) {
  static const char *names[] = {"exceptions", "bitfield", "simhalt", "elog", "olog", "logmemfrom", "logmembytes"};
  for (int o = 0; o < 7; o++)
    if (name == names[o]) return o;
  fail("unknown option", name);
  return -1;
}

// ---------------------------------------------------------------------------
// execution
// ---------------------------------------------------------------------------
enum { BUDGET = 1000 };
// At most this many waits are answered per command; a program that waits for ever ends the command.
enum { WAIT_LIMIT = 10000 };

/* Carry a status to its end: answer every wait as the script says, run until stopped or until
   `limit` steps have been executed since `startSteps`. */
static int settle(int status, unsigned startSteps, unsigned limit) {
  char b[64];
  for (int waits = 0;; waits++) {
    if (waits == WAIT_LIMIT) {
      sprintf(b, "wait-limit %d", status);
      line(b);
      return status;
    }
    switch (status) {
      case SIM_WAIT_ALERT:
        line("wait alert");
        sim_alert_dismissed();
        break;
      case SIM_WAIT_DELAY: {
        unsigned remaining = sim_delay_remaining();
        sprintf(b, "wait delay %u", remaining);
        line(b);
        sim_delay_elapsed(remaining);
        break;
      }
      case SIM_WAIT_HOST:
        line("wait host");
        if (!dialogReplies.empty()) {
          DialogReply r = dialogReplies.front();
          dialogReplies.pop_front();
          sim_file_dialog_reply(r.accepted ? 1 : 0, r.name.c_str());
        } else
          sim_file_dialog_reply(0, "");
        break;
      case SIM_WAIT_INPUT:
        if (keys.empty()) {
          line("wait input-exhausted");
          return status;
        }
        sim_key_char(keys.front());
        keys.pop_front();
        break;
      case SIM_RUNNING:
        if (sim_step_count() - startSteps >= limit) {
          line("limit");
          return status;
        }
        break;
      default:
        return status;
    }
    unsigned done = sim_step_count() - startSteps;
    unsigned left = done >= limit ? 0 : limit - done;
    status = sim_run((int)(left < BUDGET ? left : BUDGET));
  }
}

static void reportStatus(int status, unsigned startSteps) {
  char b[64];
  sprintf(b, "status %d steps %u", status, sim_step_count() - startSteps);
  line(b);
}

static void dumpFiles() {
  std::vector<std::string> names;
  _finddata_t fd;
  intptr_t h = _findfirst((sandboxDir + "\\*").c_str(), &fd);
  if (h != -1) {
    do {
      if (!(fd.attrib & _A_SUBDIR)) names.push_back(fd.name);
    } while (_findnext(h, &fd) == 0);
    _findclose(h);
  }
  std::sort(names.begin(), names.end(), [](const std::string &a, const std::string &b) {
    std::string x = a, y = b;
    for (size_t i = 0; i < x.size(); i++) x[i] = (char)tolower((unsigned char)x[i]);
    for (size_t i = 0; i < y.size(); i++) y[i] = (char)tolower((unsigned char)y[i]);
    return x < y;
  });
  char b[64];
  sprintf(b, "files %u", (unsigned)names.size());
  line(b);
  for (size_t k = 0; k < names.size(); k++) {
    std::vector<unsigned char> data;
    readFile(sandboxDir + "\\" + names[k], data);
    std::string s = "file ";
    escaped(s, (const unsigned char *)names[k].data(), names[k].size());
    sprintf(b, " %u ", (unsigned)data.size());
    s += b;
    for (size_t i = 0; i < data.size(); i++) {
      sprintf(b, "%02X", data[i]);
      s += b;
    }
    line(s);
  }
}

static void dump(const std::vector<Token> &t) {
  if (t.size() < 2) fail("dump what?");
  const std::string &what = t[1].text;
  char b[160];
  unsigned char *mem = sim_memory();
  if (what == "regs") {
    std::string s = "regs";
    static const char *names[] = {"D0", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "A0", "A1",
                                  "A2", "A3", "A4", "A5", "A6", "USP", "SSP", "PC"};
    for (int r = 0; r < 18; r++) {
      sprintf(b, " %s=%08X", names[r], (unsigned)sim_reg_get(r));
      s += b;
    }
    unsigned long long cycles = ((unsigned long long)sim_cycles_hi() << 32) | sim_cycles_lo();
    sprintf(b, " SR=%04X cycles=%llu", (unsigned)sim_reg_get(SIM_SR) & 0xFFFF, cycles);
    s += b;
    line(s);
  } else if (what == "state") {
    std::string s = "state";
    for (int i = 0; i <= SIM_ST_HOST_REQUEST; i++) {
      sprintf(b, " %d", sim_state(i));
      s += b;
    }
    line(s);
  } else if (what == "boxes") {
    std::string s = "boxes";
    for (int i = 0; i < SIM_BOX_COUNT; i++) {
      const char *text = sim_box_text(i);
      s += ' ';
      escaped(s, (const unsigned char *)text, strlen(text));
    }
    line(s);
  } else if (what == "log") {
    std::vector<unsigned char> data;
    readFile(twin_log_path(), data);
    std::string s = "log ";
    escaped(s, data.empty() ? (const unsigned char *)"" : &data[0], data.size());
    line(s);
  } else if (what == "files") {
    dumpFiles();
  } else if (what == "mem") {
    if (t.size() != 4) fail("dump mem <address> <length>");
    unsigned addr = (unsigned)number(t[2]) & 0xFFFFFF;
    long len = number(t[3]);
    for (long done = 0; done < len; done += 32) {
      sprintf(b, "mem %06X ", (addr + (unsigned)done) & 0xFFFFFF);
      std::string s = b;
      for (long i = done; i < len && i < done + 32; i++) {
        sprintf(b, "%02X", mem[(addr + (unsigned)i) & 0xFFFFFF]);
        s += b;
      }
      line(s);
    }
  } else if (what == "crc") {
    // CRC-32 (IEEE 802.3, as zlib) of a memory range
    if (t.size() != 4) fail("dump crc <address> <length>");
    unsigned addr = (unsigned)number(t[2]) & 0xFFFFFF;
    unsigned long len = (unsigned long)number(t[3]);
    unsigned crc = 0;
    for (unsigned long i = 0; i < len; i++) crc = crc32(&mem[(addr + i) & 0xFFFFFF], 1, crc);
    sprintf(b, "crc %06X %lu %08X", addr, len, crc);
    line(b);
  } else if (what == "bytes") {
    std::string s = "bytes ";
    for (size_t i = 2; i < t.size(); i++) {
      sprintf(b, "%02X", mem[(unsigned)number(t[i]) & 0xFFFFFF]);
      s += b;
    }
    line(s);
  } else
    fail("unknown dump", what);
}

static void command(const std::vector<Token> &t) {
  const std::string &c = t[0].text;
  unsigned char *mem = sim_memory();
  if (c == "option") {
    if (t.size() != 3) fail("option <name> <value>");
    sim_set_option(optionNumber(t[1].text), (int)number(t[2]));
  } else if (c == "load" || c == "loaddata") {
    if (t.size() < 2) fail("load <s68> [<l68>|-] [name]");
    std::vector<unsigned char> s68, l68;
    bool haveS68 = t[1].text != "-", haveL68 = false;
    if (haveS68 && !readFile(resolvePath(t[1].text), s68)) fail("cannot read", t[1].text);
    if (c == "load" && t.size() >= 3 && t[2].text != "-") {
      if (!readFile(resolvePath(t[2].text), l68)) fail("cannot read", t[2].text);
      haveL68 = true;
    }
    size_t nameAt = c == "load" ? 3 : 2;
    std::string name = t.size() > nameAt ? t[nameAt].text : (haveS68 ? baseName(t[1].text) : std::string("program.S68"));
    if (haveS68) {
      unsigned char *p = sim_stage(SIM_STAGE_S68, (int)s68.size());
      if (!s68.empty()) memcpy(p, &s68[0], s68.size());
    }
    if (c == "loaddata") {
      int result = sim_open_data(name.c_str());
      line(result == 0 ? "loaddata ok" : "loaddata fail");
      return;
    }
    if (haveL68) {
      unsigned char *p = sim_stage(SIM_STAGE_L68, (int)l68.size());
      if (!l68.empty()) memcpy(p, &l68[0], l68.size());
    }
    sim_open_file(name.c_str(), SIM_OPEN_MENU);
  } else if (c == "file") {
    if (t.size() != 3) fail("file <name> <path>");
    std::vector<unsigned char> data;
    if (!readFile(resolvePath(t[2].text), data)) fail("cannot read", t[2].text);
    if (!twin_plain_name(t[1].text.c_str())) fail("not a plain file name", t[1].text);
    FILE *f = fopen((sandboxDir + "\\" + t[1].text).c_str(), "wb");
    if (!f) fail("cannot write sandbox file", t[1].text);
    if (!data.empty()) fwrite(&data[0], 1, data.size(), f);
    fclose(f);
  } else if (c == "reg") {
    if (t.size() != 3) fail("reg <name> <value>");
    sim_reg_set(registerNumber(t[1].text), (int)number(t[2]));
  } else if (c == "poke") {
    if (t.size() != 3 || t[2].text.size() % 2) fail("poke <address> <hex bytes>");
    unsigned addr = (unsigned)number(t[1]);
    const std::string &h = t[2].text;
    for (size_t i = 0; i < h.size(); i += 2) {
      int hi = hexDigit(h[i]), lo = hexDigit(h[i + 1]);
      if (hi < 0 || lo < 0) fail("bad hex bytes", h);
      mem[(addr + (unsigned)(i / 2)) & 0xFFFFFF] = (unsigned char)(hi * 16 + lo);
    }
  } else if (c == "keys") {
    if (t.size() != 2) fail("keys <string>");
    for (size_t i = 0; i < t[1].text.size(); i++) keys.push_back((unsigned char)t[1].text[i]);
  } else if (c == "time") {
    if (t.size() != 2) fail("time <centiseconds>");
    timeValue = (unsigned)number(t[1]);
  } else if (c == "dialog") {
    DialogReply r;
    if (t.size() == 3 && t[1].text == "accept") { r.accepted = true; r.name = t[2].text; }
    else if (t.size() == 2 && t[1].text == "cancel") r.accepted = false;
    else fail("dialog accept <name> | dialog cancel");
    dialogReplies.push_back(r);
  } else if (c == "run") {
    if (t.size() != 2) fail("run <max steps>");
    unsigned start = sim_step_count();
    sim_cmd_run();
    int status = settle(sim_run(0), start, (unsigned)number(t[1]));
    reportStatus(status, start);
  } else if (c == "trace") {
    if (t.size() != 2) fail("trace <count>");
    long n = number(t[1]);
    unsigned start = sim_step_count();
    int status = SIM_STOPPED;
    for (long i = 0; i < n; i++) {
      unsigned before = sim_step_count();
      status = settle(sim_cmd_trace(), before, 0);
    }
    reportStatus(status, start);
  } else if (c == "pause") {
    sim_cmd_pause();
  } else if (c == "rewind") {
    sim_rewind();
  } else if (c == "irq") {
    if (t.size() != 2) fail("irq <level>");
    unsigned start = sim_step_count();
    if (sim_irq((int)number(t[1]))) reportStatus(settle(sim_run(0), start, 0x7FFFFFFF), start);
  } else if (c == "logdialog") {
    sim_log_dialog_opened();
  } else if (c == "logstart") {
    if (t.size() != 2) fail("logstart <time text>");
    sim_log_start(t[1].text.c_str());
  } else if (c == "logstop") {
    sim_log_stop();
  } else if (c == "hostlog") {
    if (t.size() != 2) fail("hostlog on|off");
    hostLog = t[1].text == "on";
  } else if (c == "echo") {
    std::string s = "echo";
    for (size_t i = 1; i < t.size(); i++) s += " " + t[i].text;
    line(s);
  } else if (c == "dump") {
    dump(t);
  } else
    fail("unknown command", c);
}

static void ignoreInvalidParameter(const wchar_t *, const wchar_t *, const wchar_t *, unsigned int, uintptr_t) {}

int main(int argc, char **argv) {
  _set_invalid_parameter_handler(ignoreInvalidParameter);
  _CrtSetReportMode(_CRT_ASSERT, 0);
  const char *scriptPath = 0, *sandbox = 0, *work = 0, *outPath = 0;
  for (int i = 1; i + 1 < argc; i += 2) {
    if (!strcmp(argv[i], "--script")) scriptPath = argv[i + 1];
    else if (!strcmp(argv[i], "--sandbox")) sandbox = argv[i + 1];
    else if (!strcmp(argv[i], "--work")) work = argv[i + 1];
    else if (!strcmp(argv[i], "--out")) outPath = argv[i + 1];
    else { fprintf(stderr, "unknown argument %s\n", argv[i]); return 2; }
  }
  if (!scriptPath || !sandbox || !work || (argc % 2) != 1) {
    fprintf(stderr, "usage: sim-twin --script <file> --sandbox <dir> --work <dir> [--out <file>]\n");
    return 2;
  }
  std::vector<unsigned char> script;
  if (!readFile(scriptPath, script)) { fprintf(stderr, "cannot read %s\n", scriptPath); return 2; }
  std::string sp = scriptPath;
  size_t slash = sp.find_last_of("\\/");
  scriptDir = slash == std::string::npos ? std::string() : sp.substr(0, slash + 1);
  sandboxDir = sandbox;
  out = outPath ? fopen(outPath, "wb") : stdout;
  if (!out) { fprintf(stderr, "cannot write %s\n", outPath); return 2; }
  setvbuf(out, NULL, _IOFBF, 1 << 16);
  twin_files_init(sandbox, work);

  sim_boot();
  std::string text(script.begin(), script.end());
  size_t pos = 0;
  while (pos <= text.size()) {
    size_t end = text.find('\n', pos);
    if (end == std::string::npos) end = text.size();
    std::string l = text.substr(pos, end - pos);
    pos = end + 1;
    lineNumber++;
    if (!l.empty() && l[l.size() - 1] == '\r') l.erase(l.size() - 1);
    size_t first = l.find_first_not_of(" \t");
    if (first == std::string::npos || l[first] == '#') continue;
    std::vector<Token> tokens = tokenize(l);
    if (!tokens.empty()) command(tokens);
  }
  fflush(out);
  if (outPath) fclose(out);
  return 0;
}
