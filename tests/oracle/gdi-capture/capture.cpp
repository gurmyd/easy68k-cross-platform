// GDI capture program (ARCHITECTURE.md 6.2.3). Owner: T2.
//
// Re-measures on real Windows what trap15-tasks-60-up.md section 6 says about GDI, and writes the
// reference files that the port's drawing surface (SH1, SH2) and text screen (SH3) are held to.
//
//   gdi-capture.exe cases <case-list.txt> <out-dir>   one .pix per case + pen.txt
//   gdi-capture.exe fonts <out-dir>                   metrics.tsv, outline.tsv, raster atlases
//   gdi-capture.exe spots <out-dir>                   spots.json (colours, ROP2, dots, ...)
//   gdi-capture.exe info                              the machine settings line, on stdout
//
// The program draws ONLY into memory device contexts holding a 32-bit top-down DIB section. It
// never creates a window. It is DPI-unaware (gdi-capture.manifest), so GDI works at 96 DPI
// whatever the display scaling is. Every output carries the machine's font-smoothing settings.
//
// It makes the GDI calls the VCL of C++Builder makes for SIM68K.exe (trap15-b section 15): a pen
// from CreatePenIndirect(PS_SOLID, width, ColorToRGB(colour)), a solid brush, SetROP2 from the
// VCL's PenModes table, MoveToEx/LineTo followed by SetPixel on the end point, Rectangle and
// Ellipse with the "+1" of simIOu.cpp, ExtFloodFill(FLOODFILLSURFACE) with the colour read just
// before, and TextOut = ExtTextOut(flags 0) on an opaque cell in the brush colour followed by
// MoveTo(x + TextWidth(text), y). Fonts are created as VCL's TFont.GetHandle does.
//
// Pixels are written as $00BBGGRR (the colour format of the 68000 program and of the port).

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <map>
#include <set>
#include <string>
#include <vector>

// ---------------------------------------------------------------------------------------------
// Small helpers

static void fail(const char* message, const char* detail = "") {
  std::fprintf(stderr, "gdi-capture: %s%s\n", message, detail);
  std::exit(2);
}

static void writeFile(const std::string& path, const void* data, size_t size) {
  FILE* f = std::fopen(path.c_str(), "wb");
  if (!f) fail("cannot write ", path.c_str());
  if (size && std::fwrite(data, 1, size, f) != size) fail("write failed: ", path.c_str());
  std::fclose(f);
}

static void writeText(const std::string& path, const std::string& text) { writeFile(path, text.data(), text.size()); }

static void ensureDir(const std::string& path) {
  // Creates every missing folder of `path` (backslashes or slashes).
  std::string partial;
  for (size_t i = 0; i < path.size(); i++) {
    char c = path[i];
    partial += c;
    if ((c == '\\' || c == '/') && partial.size() > 3) CreateDirectoryA(partial.c_str(), nullptr);
  }
  CreateDirectoryA(path.c_str(), nullptr);
}

static std::string fmt(const char* format, ...) {
  char buffer[4096];
  va_list args;
  va_start(args, format);
  std::vsnprintf(buffer, sizeof buffer, format, args);
  va_end(args);
  return buffer;
}

// ---------------------------------------------------------------------------------------------
// Machine settings written into every output

static std::string machineSettingsJson() {
  // Windows version from RtlGetVersion (GetVersionEx lies to programs without a manifest entry).
  typedef LONG(WINAPI * RtlGetVersionFn)(OSVERSIONINFOW*);
  OSVERSIONINFOW version = {};
  version.dwOSVersionInfoSize = sizeof version;
  HMODULE ntdll = GetModuleHandleA("ntdll.dll");
  if (ntdll) {
    auto fn = reinterpret_cast<RtlGetVersionFn>(reinterpret_cast<void*>(GetProcAddress(ntdll, "RtlGetVersion")));
    if (fn) fn(&version);
  }
  BOOL smoothing = FALSE;
  UINT smoothingType = 0, contrast = 0, orientation = 0;
  SystemParametersInfoA(SPI_GETFONTSMOOTHING, 0, &smoothing, 0);
  SystemParametersInfoA(SPI_GETFONTSMOOTHINGTYPE, 0, &smoothingType, 0);
  SystemParametersInfoA(SPI_GETFONTSMOOTHINGCONTRAST, 0, &contrast, 0);
  SystemParametersInfoA(SPI_GETFONTSMOOTHINGORIENTATION, 0, &orientation, 0);
  HDC screen = GetDC(nullptr);
  int dpiY = GetDeviceCaps(screen, LOGPIXELSY);
  ReleaseDC(nullptr, screen);
  return fmt(
      "{\"windows\": \"%lu.%lu.%lu\", \"ansiCodePage\": %u, \"logPixelsY\": %d, \"fontSmoothing\": %s, "
      "\"fontSmoothingType\": %s, \"fontSmoothingContrast\": %u, \"fontSmoothingOrientation\": %s}",
      version.dwMajorVersion, version.dwMinorVersion, version.dwBuildNumber, GetACP(), dpiY,
      smoothing ? "true" : "false",
      smoothingType == FE_FONTSMOOTHINGCLEARTYPE ? "\"cleartype\"" : smoothingType == FE_FONTSMOOTHINGSTANDARD ? "\"standard\"" : "\"other\"",
      contrast, orientation == FE_FONTSMOOTHINGORIENTATIONRGB ? "\"rgb\"" : "\"bgr\"");
}

// ---------------------------------------------------------------------------------------------
// Memory device context with a 32-bit top-down DIB section

struct Canvas {
  int width = 0, height = 0;
  HDC dc = nullptr;
  HBITMAP bitmap = nullptr, oldBitmap = nullptr;
  uint32_t* bits = nullptr;  // 0x00RRGGBB per pixel (DIB byte order B, G, R, 0)

  Canvas(int w, int h) : width(w), height(h) {
    dc = CreateCompatibleDC(nullptr);
    if (!dc) fail("CreateCompatibleDC failed");
    BITMAPINFO info = {};
    info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    info.bmiHeader.biWidth = w;
    info.bmiHeader.biHeight = -h;  // top-down
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB;
    void* p = nullptr;
    bitmap = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &p, nullptr, 0);
    if (!bitmap) fail("CreateDIBSection failed");
    bits = static_cast<uint32_t*>(p);
    oldBitmap = static_cast<HBITMAP>(SelectObject(dc, bitmap));
    std::memset(bits, 0, size_t(w) * h * 4);  // black
  }
  ~Canvas() {
    SelectObject(dc, oldBitmap);
    DeleteObject(bitmap);
    DeleteDC(dc);
  }
  Canvas(const Canvas&) = delete;
  Canvas& operator=(const Canvas&) = delete;

  void flush() const { GdiFlush(); }
  /** Pixel as $00BBGGRR. */
  uint32_t bbggrr(int x, int y) const {
    uint32_t v = bits[size_t(y) * width + x];
    return ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff);
  }
  void fillAll(uint32_t bbggrrColour) {
    uint32_t v = ((bbggrrColour & 0xff) << 16) | (bbggrrColour & 0xff00) | ((bbggrrColour >> 16) & 0xff);
    for (size_t i = 0; i < size_t(width) * height; i++) bits[i] = v;
  }
};

/** .pix (ARCHITECTURE.md 6.5.3): "E68P", version 1, width u16, height u16, runs (count u32, colour u32). */
static std::vector<uint8_t> encodePix(const Canvas& c) {
  c.flush();
  std::vector<uint8_t> out = {'E', '6', '8', 'P', 1, uint8_t(c.width & 0xff), uint8_t(c.width >> 8),
                              uint8_t(c.height & 0xff), uint8_t(c.height >> 8)};
  auto put32 = [&](uint32_t v) {
    for (int i = 0; i < 4; i++) out.push_back(uint8_t(v >> (8 * i)));
  };
  size_t total = size_t(c.width) * c.height;
  size_t i = 0;
  while (i < total) {
    uint32_t colour = c.bbggrr(int(i % c.width), int(i / c.width));
    size_t j = i + 1;
    while (j < total && c.bbggrr(int(j % c.width), int(j / c.width)) == colour) j++;
    put32(uint32_t(j - i));
    put32(colour);
    i = j;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The VCL canvas, as SIM68K.exe uses it

// TPenMode -> ROP2 word, the table at $005270B4 (trap15-b 5.4).
static const int PEN_MODES[16] = {1, 16, 11, 6, 13, 4, 14, 5, 12, 3, 15, 2, 9, 8, 7, 10};

/** Mode 0-255 as set by task 92 -> the mode 0-15 it behaves as (trap15-b 5.4, exception table). */
static int effectiveMode(int mode) {
  if (mode >= 0 && mode < 16) return mode;
  static const struct {
    int as;
    int values[12];
  } table[] = {
      {0, {66, 98, 108, 116, 128, 140, 178, 188, 193, 222, 230}},
      {2, {146, 154}},
      {3, {118, 142}},
      {4, {158}},
      {5, {22, 24, 64, 84, 92, 122, 166, 168, 234}},
      {6, {162, 192}},
      {7, {78, 172}},
      {8, {156}},
      {9, {82, 120, 126, 132, 174, 180}},
      {10, {44, 48, 51, 52, 53, 55, 56, 57, 160}},
      {11, {80, 88, 110, 136, 164, 170, 184, 220, 232}},
      {12, {144}},
      {13, {65, 102, 150, 208, 236}},
      {14, {124, 130, 209, 212, 213}},
      {15, {148, 152}},
  };
  for (const auto& row : table)
    for (int v : row.values)
      if (v != 0 && v == mode) return row.as;
  return 1;
}

/** VCL ColorToRGB: a negative TColor is a system colour index, anything else goes to GDI unchanged. */
static COLORREF colorToRGB(uint32_t c) { return (c & 0x80000000u) ? GetSysColor(int(c & 0xff)) : COLORREF(c); }

struct VclFont {
  std::string name = "Fixedsys";
  int size = 9;   // points; 0 lets Windows choose
  int style = 0;  // 0 plain, 1 bold, 2 italic, 3 underline, 4 strike-out (only one, trap15-a task 21)
};

/** TFont.GetHandle of the VCL: LOGFONT with Height = -MulDiv(Size, 96, 72). */
static HFONT createVclFont(const VclFont& f) {
  LOGFONTA lf = {};
  lf.lfHeight = f.size == 0 ? 0 : -MulDiv(f.size, 96, 72);
  lf.lfWeight = f.style == 1 ? FW_BOLD : FW_NORMAL;
  lf.lfItalic = f.style == 2;
  lf.lfUnderline = f.style == 3;
  lf.lfStrikeOut = f.style == 4;
  lf.lfCharSet = ANSI_CHARSET;  // the Options font's charset (trap15-a 3.2), copied by task 21
  lf.lfOutPrecision = OUT_DEFAULT_PRECIS;
  lf.lfClipPrecision = CLIP_DEFAULT_PRECIS;
  lf.lfQuality = DEFAULT_QUALITY;
  lf.lfPitchAndFamily = DEFAULT_PITCH;
  std::strncpy(lf.lfFaceName, f.name.c_str(), LF_FACESIZE - 1);
  HFONT h = CreateFontIndirectA(&lf);
  if (!h) fail("CreateFontIndirect failed for ", f.name.c_str());
  return h;
}

struct VclCanvas {
  Canvas& c;
  uint32_t penColor = 0x00FFFFFF, fillColor = 0, fontColor = 0x00FFFFFF;
  int penWidth = 1, penMode = 4;
  VclFont font;

  explicit VclCanvas(Canvas& canvas) : c(canvas) { MoveToEx(c.dc, 0, 0, nullptr); }

  // "Realising" the pen and brush as the VCL does before each call.
  void withPen(bool brush, bool clearBrush, void (*draw)(HDC, const int*), const int* args) {
    LOGPEN lp = {PS_SOLID, {penWidth, 0}, colorToRGB(penColor)};
    HPEN pen = CreatePenIndirect(&lp);
    HBRUSH br = brush ? CreateSolidBrush(colorToRGB(fillColor)) : nullptr;
    HGDIOBJ oldPen = SelectObject(c.dc, pen);
    HGDIOBJ oldBrush = SelectObject(c.dc, clearBrush ? GetStockObject(NULL_BRUSH) : (br ? br : GetStockObject(NULL_BRUSH)));
    SetROP2(c.dc, PEN_MODES[effectiveMode(penMode)]);
    draw(c.dc, args);
    SelectObject(c.dc, oldPen);
    SelectObject(c.dc, oldBrush);
    DeleteObject(pen);
    if (br) DeleteObject(br);
  }

  void setPixel(int x, int y) {
    int a[3] = {x, y, int(colorToRGB(penColor))};
    withPen(false, false, [](HDC dc, const int* v) { SetPixel(dc, v[0], v[1], COLORREF(v[2])); }, a);
  }
  void moveTo(int x, int y) { MoveToEx(c.dc, x, y, nullptr); }
  void lineTo(int x, int y) {
    int a[2] = {x, y};
    withPen(false, false, [](HDC dc, const int* v) { LineTo(dc, v[0], v[1]); }, a);
    setPixel(x, y);  // "plot to fix builder bug" (simIOu.cpp:1881)
  }
  void line(int x1, int y1, int x2, int y2) {
    moveTo(x1, y1);
    lineTo(x2, y2);
  }
  static void sort(int& x1, int& y1, int& x2, int& y2) {
    if (x1 > x2) std::swap(x1, x2);
    if (y1 > y2) std::swap(y1, y2);
  }
  void rectangle(int x1, int y1, int x2, int y2, bool filled) {
    sort(x1, y1, x2, y2);
    int a[4] = {x1, y1, x2 + 1, y2 + 1};
    withPen(filled, !filled, [](HDC dc, const int* v) { Rectangle(dc, v[0], v[1], v[2], v[3]); }, a);
  }
  void ellipse(int x1, int y1, int x2, int y2, bool filled) {
    sort(x1, y1, x2, y2);
    if (x1 + y1 + x2 + y2 >= 32768) return;  // the Windows 95 limit kept in simIOu.cpp
    int a[4] = {x1, y1, x2 + 1, y2 + 1};
    withPen(filled, !filled, [](HDC dc, const int* v) { Ellipse(dc, v[0], v[1], v[2], v[3]); }, a);
  }
  void floodFill(int x, int y) {
    COLORREF target = GetPixel(c.dc, x, y);  // Pixels[x][y], read first
    HBRUSH br = CreateSolidBrush(colorToRGB(fillColor));
    HGDIOBJ old = SelectObject(c.dc, br);
    SetROP2(c.dc, PEN_MODES[effectiveMode(penMode)]);  // trap15-b 6.6 / 5.4: the current mode
    if (target != CLR_INVALID) ExtFloodFill(c.dc, x, y, target, FLOODFILLSURFACE);
    SelectObject(c.dc, old);
    DeleteObject(br);
  }
  /** TCanvas.TextOut: font and brush realised, ExtTextOut(flags 0), then MoveTo(x + TextWidth, y). */
  void textOut(int x, int y, const std::string& bytes) {
    HFONT hf = createVclFont(font);
    HBRUSH br = CreateSolidBrush(colorToRGB(fillColor));
    HGDIOBJ oldFont = SelectObject(c.dc, hf);
    HGDIOBJ oldBrush = SelectObject(c.dc, br);
    SetTextColor(c.dc, colorToRGB(fontColor));
    SetBkColor(c.dc, colorToRGB(fillColor));
    SetBkMode(c.dc, OPAQUE);
    ExtTextOutA(c.dc, x, y, 0, nullptr, bytes.data(), UINT(bytes.size()), nullptr);
    SIZE extent = {};
    GetTextExtentPoint32A(c.dc, bytes.data(), int(bytes.size()), &extent);
    MoveToEx(c.dc, x + extent.cx, y, nullptr);
    SelectObject(c.dc, oldFont);
    SelectObject(c.dc, oldBrush);
    DeleteObject(hf);
    DeleteObject(br);
  }
  POINT pen() const {
    POINT p = {};
    GetCurrentPositionEx(c.dc, &p);
    return p;
  }
};

// ---------------------------------------------------------------------------------------------
// cases: replay a case list (format in cases.ts, serializeCases)

static std::vector<std::string> splitWords(const std::string& line, size_t maxWords) {
  std::vector<std::string> words;
  size_t i = 0;
  while (i < line.size()) {
    while (i < line.size() && line[i] == ' ') i++;
    if (i >= line.size()) break;
    if (words.size() + 1 == maxWords) {
      words.push_back(line.substr(i));
      break;
    }
    size_t j = line.find(' ', i);
    if (j == std::string::npos) j = line.size();
    words.push_back(line.substr(i, j - i));
    i = j;
  }
  return words;
}

static int toInt(const std::string& s) { return int(std::strtol(s.c_str(), nullptr, 10)); }
static uint32_t toColour(const std::string& s) { return uint32_t(std::strtoul(s.c_str(), nullptr, 16)); }
static std::string fromHex(const std::string& s) {
  std::string out;
  for (size_t i = 0; i + 1 < s.size(); i += 2) out += char(std::strtoul(s.substr(i, 2).c_str(), nullptr, 16));
  return out;
}

static int runCases(const char* listPath, const std::string& outDir) {
  FILE* f = std::fopen(listPath, "rb");
  if (!f) fail("cannot read ", listPath);
  std::string text;
  char buffer[65536];
  size_t n;
  while ((n = std::fread(buffer, 1, sizeof buffer, f)) > 0) text.append(buffer, n);
  std::fclose(f);

  ensureDir(outDir + "\\pix");
  std::string penLog;
  Canvas* canvas = nullptr;
  VclCanvas* vcl = nullptr;
  std::string id;
  int count = 0;
  size_t pos = 0;
  int lineNo = 0;
  while (pos < text.size()) {
    size_t end = text.find('\n', pos);
    if (end == std::string::npos) end = text.size();
    std::string line = text.substr(pos, end - pos);
    pos = end + 1;
    lineNo++;
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line.empty() || line[0] == '#') continue;
    std::vector<std::string> w = splitWords(line, line.rfind("font ", 0) == 0 ? 4 : 16);
    const std::string& op = w[0];
    auto need = [&](size_t k) {
      if (w.size() != k + 1) fail("bad case line: ", line.c_str());
      if (op != "case" && !vcl) fail("operation outside a case: ", line.c_str());
    };
    if (op == "case") {
      need(3);
      id = w[1];
      canvas = new Canvas(toInt(w[2]), toInt(w[3]));
      vcl = new VclCanvas(*canvas);
    } else if (op == "end") {
      need(0);
      std::vector<uint8_t> pix = encodePix(*canvas);
      writeFile(outDir + "\\pix\\" + id + ".pix", pix.data(), pix.size());
      POINT p = vcl->pen();
      penLog += fmt("%s %ld %ld\n", id.c_str(), p.x, p.y);
      delete vcl;
      delete canvas;
      vcl = nullptr;
      canvas = nullptr;
      count++;
    } else if (op == "bg") {
      need(1);
      canvas->flush();
      canvas->fillAll(toColour(w[1]));
    } else if (op == "pen") {
      need(1);
      vcl->penColor = toColour(w[1]);
    } else if (op == "fill") {
      need(1);
      vcl->fillColor = toColour(w[1]);
    } else if (op == "width") {
      need(1);
      vcl->penWidth = toInt(w[1]) & 0xff;
    } else if (op == "mode") {
      need(1);
      vcl->penMode = toInt(w[1]) & 0xff;
    } else if (op == "pixel") {
      need(2);
      vcl->setPixel(toInt(w[1]), toInt(w[2]));
    } else if (op == "line") {
      need(4);
      vcl->line(toInt(w[1]), toInt(w[2]), toInt(w[3]), toInt(w[4]));
    } else if (op == "lineto") {
      need(2);
      vcl->lineTo(toInt(w[1]), toInt(w[2]));
    } else if (op == "moveto") {
      need(2);
      vcl->moveTo(toInt(w[1]), toInt(w[2]));
    } else if (op == "rect" || op == "urect") {
      need(4);
      vcl->rectangle(toInt(w[1]), toInt(w[2]), toInt(w[3]), toInt(w[4]), op == "rect");
    } else if (op == "ellipse" || op == "uellipse") {
      need(4);
      vcl->ellipse(toInt(w[1]), toInt(w[2]), toInt(w[3]), toInt(w[4]), op == "ellipse");
    } else if (op == "flood") {
      need(2);
      vcl->floodFill(toInt(w[1]), toInt(w[2]));
    } else if (op == "font") {
      need(3);
      vcl->font.size = toInt(w[1]);
      vcl->font.style = toInt(w[2]);
      vcl->font.name = w[3];
    } else if (op == "fontcolor") {
      need(1);
      vcl->fontColor = toColour(w[1]);
    } else if (op == "text") {
      if (w.size() == 3) w.push_back("");
      need(3);
      vcl->textOut(toInt(w[1]), toInt(w[2]), fromHex(w[3]));
    } else {
      fail("unknown operation: ", line.c_str());
    }
  }
  if (vcl) fail("case list ends inside a case");
  writeText(outDir + "\\pen.txt", penLog);
  writeText(outDir + "\\cases-info.json", "{\"capturedOn\": " + machineSettingsJson() + fmt(", \"cases\": %d}\n", count));
  std::printf("%d cases captured\n", count);
  return 0;
}

// ---------------------------------------------------------------------------------------------
// fonts: metric table, outline-face measurements, raster-font atlases

static const char* const FONT_NAMES[7] = {"Fixedsys", "Courier", "Courier New", "Lucida Console",
                                          "Lucida Sans Typerwriter", "Consolas", "Terminal"};
static const char* const STYLE_KEYS[5] = {"", "b", "i", "u", "s"};
static const int OUTLINE_SIZES[12] = {8, 9, 10, 11, 12, 14, 16, 18, 24, 36, 48, 72};

// The control bytes that Windows draws, in the raster faces, from a fallback font rather than from
// the face: $00-$08, $0B, $0E-$1B. What they paint (and the length of their underline) depends on the
// fallback font of the Windows at hand: Windows 11 10.0.26300 paints an anti-aliased narrow box,
// Windows Server 10.0.26100 a wider box without anti-aliasing (CI run 44919519853). So they cannot
// decide whether a raster rule holds; tests/oracle/gdi-capture/machine-dependent.ts has the same list
// (OTHER_FONT_BYTES) and leaves them out of the comparison. Their advances are the face's and are kept.
static bool otherFontByte(int c) { return c <= 8 || c == 11 || (c >= 14 && c <= 27); }

struct Measured {
  int colWidth = 0, rowHeight = 0;
  std::string face;
  bool raster = false;
  TEXTMETRICA tm = {};
};

static Measured measure(HDC dc, const VclFont& f) {
  HFONT hf = createVclFont(f);
  HGDIOBJ old = SelectObject(dc, hf);
  Measured m;
  SIZE s = {};
  GetTextExtentPoint32A(dc, "W", 1, &s);
  m.colWidth = s.cx;
  GetTextExtentPoint32A(dc, "Xp", 2, &s);
  m.rowHeight = s.cy;
  char face[LF_FACESIZE + 1] = {};
  GetTextFaceA(dc, LF_FACESIZE, face);
  m.face = face;
  GetTextMetricsA(dc, &m.tm);
  m.raster = (m.tm.tmPitchAndFamily & (TMPF_VECTOR | TMPF_TRUETYPE)) == 0;
  SelectObject(dc, old);
  DeleteObject(hf);
  return m;
}

/** One glyph rendered white on black, transparent, at (8, 0) of a canvas `w` wide and `h` high. */
struct GlyphPixels {
  int width = 0, height = 0;
  std::vector<uint32_t> px;  // $00BBGGRR
};

static GlyphPixels renderGlyph(const VclFont& f, unsigned char ch, int w, int h) {
  Canvas c(w, h);
  HFONT hf = createVclFont(f);
  HGDIOBJ old = SelectObject(c.dc, hf);
  SetTextColor(c.dc, RGB(255, 255, 255));
  SetBkMode(c.dc, TRANSPARENT);
  char b = char(ch);
  ExtTextOutA(c.dc, 8, 0, 0, nullptr, &b, 1, nullptr);
  SelectObject(c.dc, old);
  DeleteObject(hf);
  c.flush();
  GlyphPixels g;
  g.width = w;
  g.height = h;
  g.px.resize(size_t(w) * h);
  for (int y = 0; y < h; y++)
    for (int x = 0; x < w; x++) g.px[size_t(y) * w + x] = c.bbggrr(x, y);
  return g;
}

static int charExtent(HDC dc, const VclFont& f, unsigned char ch) {
  HFONT hf = createVclFont(f);
  HGDIOBJ old = SelectObject(dc, hf);
  SIZE s = {};
  char b = char(ch);
  GetTextExtentPoint32A(dc, &b, 1, &s);
  SelectObject(dc, old);
  DeleteObject(hf);
  return s.cx;
}

static int stringExtent(HDC dc, const VclFont& f, const char* bytes, int count) {
  HFONT hf = createVclFont(f);
  HGDIOBJ old = SelectObject(dc, hf);
  SIZE s = {};
  GetTextExtentPoint32A(dc, bytes, count, &s);
  SelectObject(dc, old);
  DeleteObject(hf);
  return s.cx;
}

struct RasterKey {
  std::string face;
  int style, colWidth, rowHeight;
  bool operator<(const RasterKey& o) const {
    if (face != o.face) return face < o.face;
    if (style != o.style) return style < o.style;
    if (rowHeight != o.rowHeight) return rowHeight < o.rowHeight;
    return colWidth < o.colWidth;
  }
};

static std::string fileFace(const std::string& face) {
  // Face names go into file names unchanged except that a space becomes '_' (see README.md).
  std::string out = face;
  for (char& c : out)
    if (c == ' ') c = '_';
  return out;
}

static int runFonts(const std::string& outDir) {
  ensureDir(outDir + "\\bitmap");
  Canvas probe(16, 16);
  HDC dc = probe.dc;

  // 1. The metric table: every name, style and size 0-255.
  std::string tsv = "# name\tstyle\tsize\tcolWidth\trowHeight\tface\tkind\ttmHeight\ttmAscent\ttmOverhang\n";
  std::map<RasterKey, VclFont> rasterFirst;  // first request that produced each raster face/style/plain cell
  std::map<std::string, std::map<int, std::pair<int, int>>> plainCell;  // name -> size -> plain cell
  for (const char* name : FONT_NAMES) {
    for (int style = 0; style < 5; style++) {
      for (int size = 0; size < 256; size++) {
        VclFont f;
        f.name = name;
        f.size = size;
        f.style = style;
        Measured m = measure(dc, f);
        tsv += fmt("%s\t%s\t%d\t%d\t%d\t%s\t%s\t%ld\t%ld\t%ld\n", name, style ? STYLE_KEYS[style] : "-", size,
                   m.colWidth, m.rowHeight, m.face.c_str(), m.raster ? "raster" : "outline", m.tm.tmHeight,
                   m.tm.tmAscent, m.tm.tmOverhang);
        if (style == 0) plainCell[std::string(name)][size] = {m.colWidth, m.rowHeight};
        if (m.raster) {
          // Keyed by the PLAIN cell of the same request: a styled raster font is the plain one
          // with a style simulated by GDI (bold is one pixel wider than the plain cell).
          std::pair<int, int> plain = plainCell[std::string(name)][size];
          RasterKey key = {m.face, style, plain.first, plain.second};
          if (!rasterFirst.count(key)) rasterFirst[key] = f;
        }
      }
    }
  }
  writeText(outDir + "\\metrics.tsv", tsv);

  // 2. Outline faces at the atlas sizes: what make-font-atlases.mjs needs to place its substitutes.
  std::string outline =
      "# name\tstyle\tsize\tface\tcolWidth\trowHeight\tppem\ttmHeight\ttmAscent\ttmDescent\ttmInternalLeading\t"
      "tmOverhang\tunderscorePosition\tunderscoreSize\tstrikeoutPosition\tstrikeoutSize\tadvances[256]\t"
      "delInHighString\n";
  for (const char* name : {"Courier New", "Lucida Console", "Consolas", "Lucida Sans Typerwriter"}) {
    for (int style = 0; style < 5; style++) {
      for (int size : OUTLINE_SIZES) {
        VclFont f;
        f.name = name;
        f.size = size;
        f.style = style;
        Measured m = measure(dc, f);
        HFONT hf = createVclFont(f);
        HGDIOBJ old = SelectObject(dc, hf);
        OUTLINETEXTMETRICA otm = {};
        otm.otmSize = sizeof otm;
        UINT got = GetOutlineTextMetricsA(dc, sizeof otm, &otm);
        SelectObject(dc, old);
        DeleteObject(hf);
        if (!got) fail("GetOutlineTextMetrics failed for ", name);
        std::string line = fmt("%s\t%s\t%d\t%s\t%d\t%d\t%d\t%ld\t%ld\t%ld\t%ld\t%ld\t%d\t%u\t%d\t%u\t", name,
                               style ? STYLE_KEYS[style] : "-", size, m.face.c_str(), m.colWidth, m.rowHeight,
                               MulDiv(size, 96, 72), m.tm.tmHeight, m.tm.tmAscent, m.tm.tmDescent,
                               m.tm.tmInternalLeading, m.tm.tmOverhang, otm.otmsUnderscorePosition,
                               otm.otmsUnderscoreSize, otm.otmsStrikeoutPosition, otm.otmsStrikeoutSize);
        for (int ch = 0; ch < 256; ch++) line += fmt(ch ? ",%d" : "%d", charExtent(dc, f, (unsigned char)ch));
        // $7F in a string that also has a byte of $80 or above: Windows draws it from a fallback font
        // with a width of its own (README.md "Text strings"). Measured as TextWidth($80 $7F) - TextWidth($80).
        line += fmt("\t%d", stringExtent(dc, f, "\x80\x7f", 2) - stringExtent(dc, f, "\x80", 1));
        outline += line + "\n";
      }
    }
  }
  writeText(outDir + "\\outline.tsv", outline);

  // 3. Raster fonts (README.md, "Raster fonts"). GDI scales a raster face by whole factors kx, ky
  //    (pixel repetition) and simulates bold, italic, underline and strike-out on the scaled
  //    glyphs. So only the native plain atlases are needed, plus the styled atlases at native size;
  //    every other face/style/size is checked here against the rules below and is captured as an
  //    atlas of its own only if a rule does not reproduce GDI exactly.
  //      plain      P(x, y) = N(x / kx, y / ky)                 advance = kx * native advance
  //      bold       P(x, y) | P(x - 1, y)                       advance + 1
  //      italic     P(x - (floor((h - 1) / 2) - floor(y / 2)), y)
  //      underline  P, plus the rows GDI draws under a space, across the advance
  //      strike-out the same with the strike-out rows
  struct G1 {
    int w = 0, h = 0, advance = 0;
    bool fallback = false;  // drawn by Windows from another, anti-aliased font: stored blank
    std::vector<uint8_t> px;
    uint8_t at(int x, int y) const { return x >= 0 && x < w && y >= 0 && y < h ? px[size_t(y) * w + x] : 0; }
  };
  auto renderSet = [&](const VclFont& f, int cw, int ch) {
    int w = cw * 4 + 32;
    std::vector<G1> out(256);
    for (int c = 0; c < 256; c++) {
      GlyphPixels g = renderGlyph(f, (unsigned char)c, w, ch);
      G1& o = out[c];
      o.w = w - 8;
      o.h = ch;
      o.px.assign(size_t(o.w) * ch, 0);
      bool left = false;
      for (int y = 0; y < ch; y++)
        for (int x = 0; x < w; x++) {
          uint32_t p = g.px[size_t(y) * w + x];
          if (p != 0 && p != 0xFFFFFF) o.fallback = true;
          if (p && x < 8) left = true;
          if (p && x >= 8) o.px[size_t(y) * o.w + x - 8] = 1;
        }
      if (o.fallback) std::fill(o.px.begin(), o.px.end(), uint8_t(0));
      else if (left) fail("raster glyph paints left of its origin: ", f.name.c_str());
      o.advance = charExtent(dc, f, (unsigned char)c);
    }
    return out;
  };
  std::string atlasLog = "# file\tface\tstyle\tcolWidth\trowHeight\tglyphWidth\toverhang\tblankBytes\tfrom\n";
  std::string rulesLog = "# face\tstyle\tplainColWidth\tplainRowHeight\tnative\tkx\tky\tresult\tlineRows\tlineExceptions\n";
  int atlasCount = 0, captured = 0;
  auto writeAtlas = [&](const std::string& face, int style, int cw, int ch, const std::vector<G1>& gl,
                        const VclFont& f) {
    int glyphWidth = cw;
    std::string blank;
    for (int c = 0; c < 256; c++) {
      glyphWidth = std::max(glyphWidth, gl[c].advance);
      for (int y = 0; y < ch; y++)
        for (int x = 0; x < gl[c].w; x++)
          if (gl[c].at(x, y)) glyphWidth = std::max(glyphWidth, x + 1);
      if (gl[c].fallback) blank += fmt(blank.empty() ? "%d" : ",%d", c);
    }
    if (cw > 255 || ch > 255 || glyphWidth > 255) fail("raster cell too large for an atlas: ", face.c_str());
    std::vector<uint8_t> bin = {'E', '6', '8', 'F', 2, uint8_t(cw), uint8_t(ch), uint8_t(glyphWidth), 0};
    for (int c = 0; c < 256; c++) bin.push_back(uint8_t(gl[c].advance));
    int rowBytes = (glyphWidth + 7) / 8;
    for (int c = 0; c < 256; c++)
      for (int y = 0; y < ch; y++) {
        std::vector<uint8_t> row(rowBytes, 0);
        for (int x = 0; x < glyphWidth; x++)
          if (gl[c].at(x, y)) row[x / 8] |= uint8_t(0x80 >> (x % 8));
        bin.insert(bin.end(), row.begin(), row.end());
      }
    std::string file = fmt("%s-%d%s%s.bin", fileFace(face).c_str(), ch, style ? "-" : "", STYLE_KEYS[style]);
    writeFile(outDir + "\\bitmap\\" + file, bin.data(), bin.size());
    atlasLog += fmt("%s\t%s\t%s\t%d\t%d\t%d\t%ld\t%s\t%s %d %d\n", file.c_str(), face.c_str(),
                    style ? STYLE_KEYS[style] : "-", cw, ch, glyphWidth, measure(dc, f).tm.tmOverhang,
                    blank.empty() ? "-" : blank.c_str(), f.name.c_str(), f.size, f.style);
    atlasCount++;
    return file;
  };

  struct Native {
    std::string face, file;
    int cw, ch;
    std::vector<G1> glyphs;
  };
  std::vector<Native> natives;
  // Plain cells first (the map is ordered by face, style, height, width), then the styles.
  for (int pass = 0; pass < 2; pass++) {
    for (const auto& entry : rasterFirst) {
      const RasterKey& key = entry.first;
      const VclFont& f = entry.second;
      if ((key.style == 0) != (pass == 0)) continue;
      Measured m = measure(dc, f);
      std::vector<G1> target = renderSet(f, m.colWidth, m.rowHeight);

      // Lines of underline and strike-out: the rows GDI draws under a space, which must span its advance.
      std::string lineRows = "-";
      std::vector<int> rows;
      if (key.style == 3 || key.style == 4) {
        const G1& space = target[0x20];
        for (int y = 0; y < space.h; y++) {
          int count = 0;
          for (int x = 0; x < space.w; x++) count += space.at(x, y);
          if (count == 0) continue;
          if (count != space.advance) fail("a line under a space does not span its advance: ", key.face.c_str());
          for (int x = 0; x < space.advance; x++)
            if (!space.at(x, y)) fail("a line under a space has a gap: ", key.face.c_str());
          rows.push_back(y);
        }
        lineRows.clear();
        for (int y : rows) lineRows += fmt(lineRows.empty() ? "%d" : ",%d", y);
      }

      // The native plain atlas this cell is made from: of the natives whose cell divides this one,
      // the one whose repetition (plus the style rule) leaves the fewest bytes unexplained.
      auto unexplained = [&](const Native& n, int kx, int ky) {
        std::vector<int> bytes;
        for (int c = 0; c < 256; c++) {
          const G1& t = target[c];
          const G1& ng = n.glyphs[c];
          if (t.fallback || ng.fallback) continue;
          int advance = kx * ng.advance + (key.style == 1 && ng.advance > 0 ? 1 : 0);
          bool same = t.advance == advance;
          auto P = [&](int x, int y) -> uint8_t { return x < 0 || y < 0 ? 0 : ng.at(x / kx, y / ky); };
          for (int y = 0; y < t.h && same; y++)
            for (int x = 0; x < t.w && same; x++) {
              uint8_t want = 0;
              switch (key.style) {
                case 0: want = P(x, y); break;
                case 1: want = P(x, y) | P(x - 1, y); break;
                case 2: want = P(x - ((t.h - 1) / 2 - y / 2), y); break;
                default: {
                  want = P(x, y);
                  for (int r : rows)
                    if (r == y && x < t.advance) want = 1;
                }
              }
              if (want != t.at(x, y)) same = false;
            }
          if (!same) bytes.push_back(c);
        }
        return bytes;
      };
      const Native* native = nullptr;
      int kx = 0, ky = 0;
      std::vector<int> failing;
      // Bytes the face itself draws that the rule does not explain; the other-font bytes do not count.
      auto own = [](const std::vector<int>& bytes) {
        int n = 0;
        for (int c : bytes) n += otherFontByte(c) ? 0 : 1;
        return n;
      };
      for (const Native& n : natives) {
        if (n.face != key.face || key.colWidth % n.cw || key.rowHeight % n.ch) continue;
        int nx = key.colWidth / n.cw, ny = key.rowHeight / n.ch;
        std::vector<int> f2 = unexplained(n, nx, ny);
        if (!native || own(f2) < own(failing) || (own(f2) == own(failing) && f2.size() < failing.size())) {
          failing = f2;
          native = &n;
          kx = nx;
          ky = ny;
        }
      }
      // Underline and strike-out: a few control bytes get a line of another length than their advance.
      std::string lineExceptions;
      if (native && (key.style == 3 || key.style == 4)) {
        std::vector<int> still;
        for (int c : failing) {
          const G1& t = target[c];
          const G1& ng = native->glyphs[c];
          int found = -1;
          for (int len = 0; len <= t.w && found < 0; len++) {
            bool ok = t.advance == kx * ng.advance;
            for (int y = 0; y < t.h && ok; y++)
              for (int x = 0; x < t.w && ok; x++) {
                uint8_t want = ng.at(x / kx, y / ky);
                for (int r : rows)
                  if (r == y && x < len) want = 1;
                if (want != t.at(x, y)) ok = false;
              }
            if (ok) found = len;
          }
          if (found < 0) still.push_back(c);
          else lineExceptions += fmt(lineExceptions.empty() ? "%d:%d" : ",%d:%d", c, found);
        }
        failing = still;
      }
      if (lineExceptions.empty()) lineExceptions = "-";
      std::string failText;
      if (native)
        for (int c : failing) failText += fmt(failText.empty() ? "%d" : ",%d", c);
      if (getenv("GDI_DEBUG") && native && !failing.empty())
        std::fprintf(stderr, "%s %s %dx%d: %s\n", key.face.c_str(), STYLE_KEYS[key.style], key.colWidth, key.rowHeight, failText.c_str());
      // The rule holds when it explains every byte the face draws (otherFontByte: not the face's).
      bool same = native != nullptr && own(failing) == 0;
      std::string result;
      std::string nativeFile = native ? native->file : "-";
      if (key.style == 0 && !same) {
        // A new native size of this face.
        std::string file = writeAtlas(key.face, 0, m.colWidth, m.rowHeight, target, f);
        natives.push_back({key.face, file, m.colWidth, m.rowHeight, target});
        result = "native";
        nativeFile = file;
        kx = ky = 1;
      } else if (!same) {
        writeAtlas(key.face, key.style, m.colWidth, m.rowHeight, target, f);
        result = "captured";  // no rule reproduces it: stored as its own atlas
        captured++;
      } else if (kx == 1 && ky == 1 && key.style != 0) {
        writeAtlas(key.face, key.style, m.colWidth, m.rowHeight, target, f);
        result = "rule+native-style";  // the rule holds; the native-size styled atlas is stored as well
      } else {
        result = "rule";
      }
      rulesLog += fmt("%s\t%s\t%d\t%d\t%s\t%d\t%d\t%s\t%s\t%s\n", key.face.c_str(),
                      key.style ? STYLE_KEYS[key.style] : "-", key.colWidth, key.rowHeight, nativeFile.c_str(), kx,
                      ky, result.c_str(), lineRows.c_str(), lineExceptions.c_str());
    }
  }
  writeText(outDir + "\\atlases.tsv", atlasLog);
  writeText(outDir + "\\raster-rules.tsv", rulesLog);
  std::printf("%d raster atlases written (%d cells captured because no rule reproduces them)\n", atlasCount, captured);
  writeText(outDir + "\\fonts-info.json", "{\"capturedOn\": " + machineSettingsJson() + "}\n");
  std::printf("metric table and outline measurements written\n");
  return 0;
}

// ---------------------------------------------------------------------------------------------
// spots: the spot values of trap15-b, measured directly

static int runSpots(const std::string& outDir) {
  ensureDir(outDir);
  std::string json = "{\n  \"capturedOn\": " + machineSettingsJson() + ",\n";

  // System colours (bit 31): GetSysColor of every index the low byte can name.
  json += "  \"sysColors\": [";
  for (int i = 0; i < 256; i++) {
    COLORREF c = GetSysColor(i);
    json += fmt("%s%u", i ? ", " : "", unsigned(c & 0xFFFFFF));
  }
  json += "],\n";

  // Colour forms drawn with SetPixel on the DIB: top byte 0x00-0x7F with a few low parts.
  {
    Canvas c(1, 1);
    auto drawn = [&](uint32_t colour) {
      c.fillAll(0x123456);
      VclCanvas v(c);
      v.penColor = colour;
      v.setPixel(0, 0);
      c.flush();
      return c.bbggrr(0, 0);
    };
    json += "  \"stockPalette\": [";
    for (int i = 0; i < 32; i++) json += fmt("%s%u", i ? ", " : "", drawn(0x01000000u | i));
    json += "],\n  \"colourForms\": {";
    const uint32_t forms[] = {0x00336699, 0x01010005, 0x0100FF05, 0x01000013, 0x01000014, 0x02336699, 0x04336699,
                              0x0A336699, 0x10336699, 0x03000005, 0x7F000005, 0x80000005, 0x80000008, 0x8000000F,
                              0x8000001F, 0xFF000005, 0x800000FF};
    bool first = true;
    for (uint32_t f : forms) {
      json += fmt("%s\"%08X\": %u", first ? "" : ", ", f, drawn(f));
      first = false;
    }
    json += "}\n,\n";
  }

  // The 16 raster operations, D = $336699, pen $0F0FF0, brush $F0F00F (trap15-b 5.4), on a line,
  // a pixel, a rectangle outline and a rectangle interior, for each mode 0-15.
  {
    json += "  \"modes\": [";
    for (int mode = 0; mode < 16; mode++) {
      Canvas c(16, 16);
      c.fillAll(0x336699);
      VclCanvas v(c);
      v.penColor = 0x0F0FF0;
      v.fillColor = 0xF0F00F;
      v.penMode = mode;
      v.line(0, 0, 5, 0);
      v.setPixel(0, 2);
      v.rectangle(2, 4, 8, 10, true);
      c.flush();
      json += fmt("%s{\"mode\": %d, \"line\": %u, \"pixel\": %u, \"outline\": %u, \"interior\": %u}", mode ? ",\n    " : "",
                  mode, c.bbggrr(1, 0), c.bbggrr(0, 2), c.bbggrr(2, 4), c.bbggrr(4, 6));
    }
    json += "],\n";
  }

  // Raw ROP2 values 0-255 given to GDI: the operation they act as, found by matching the result
  // of pen $0F0FF0 on $336699 against the 16 operations.
  {
    uint32_t results[17] = {};
    for (int r = 1; r <= 16; r++) {
      Canvas c(4, 1);
      c.fillAll(0x336699);
      LOGPEN lp = {PS_SOLID, {1, 0}, RGB(0xF0, 0x0F, 0x0F)};
      HPEN pen = CreatePenIndirect(&lp);
      HGDIOBJ old = SelectObject(c.dc, pen);
      SetROP2(c.dc, r);
      MoveToEx(c.dc, 0, 0, nullptr);
      LineTo(c.dc, 3, 0);
      SelectObject(c.dc, old);
      DeleteObject(pen);
      c.flush();
      results[r] = c.bbggrr(1, 0);
    }
    json += "  \"rop2Raw\": [";
    for (int r = 0; r < 256; r++) {
      Canvas c(4, 1);
      c.fillAll(0x336699);
      LOGPEN lp = {PS_SOLID, {1, 0}, RGB(0xF0, 0x0F, 0x0F)};
      HPEN pen = CreatePenIndirect(&lp);
      HGDIOBJ old = SelectObject(c.dc, pen);
      SetROP2(c.dc, PEN_MODES[4]);
      SetROP2(c.dc, r);  // GDI keeps the previous ROP2 if it rejects the value
      int actual = GetROP2(c.dc);
      MoveToEx(c.dc, 0, 0, nullptr);
      LineTo(c.dc, 3, 0);
      SelectObject(c.dc, old);
      DeleteObject(pen);
      c.flush();
      uint32_t got = c.bbggrr(1, 0);
      int as = 0;
      for (int k = 1; k <= 16 && !as; k++)
        if (results[k] == got) as = k;
      json += fmt("%s[%d, %d]", r ? ", " : "", as, actual);
    }
    json += "],\n";
  }

  // Dots: zero-length lines of width 0-14; diameter (bounding box) and pixel count.
  {
    json += "  \"dots\": [";
    for (int w = 0; w <= 14; w++) {
      Canvas c(40, 40);
      VclCanvas v(c);
      v.penWidth = w;
      v.line(20, 20, 20, 20);
      c.flush();
      int count = 0, minX = 99, maxX = -1, minY = 99, maxY = -1;
      for (int y = 0; y < 40; y++)
        for (int x = 0; x < 40; x++)
          if (c.bbggrr(x, y)) {
            count++;
            minX = std::min(minX, x), maxX = std::max(maxX, x), minY = std::min(minY, y), maxY = std::max(maxY, y);
          }
      json += fmt("%s{\"width\": %d, \"pixels\": %d, \"diameterX\": %d, \"diameterY\": %d, \"left\": %d, \"top\": %d}",
                  w ? ",\n    " : "", w, count, maxX - minX + 1, maxY - minY + 1, minX - 20, minY - 20);
    }
    json += "],\n";
  }

  // Task 95 control bytes with Fixedsys (trap15-b 6.7): painted width of 'A',b,'B' and the extent.
  {
    json += "  \"controlBytes\": [";
    for (int b = 0; b < 32; b++) {
      Canvas c(80, 20);
      VclCanvas v(c);
      std::string s = {'A', char(b), 'B'};
      v.fillColor = 0x0000FF;
      v.textOut(0, 0, s);
      c.flush();
      int right = 0;
      for (int x = 0; x < 80; x++)
        if (c.bbggrr(x, 0) == 0x0000FF) right = x + 1;
      json += fmt("%s{\"byte\": %d, \"cellRight\": %d, \"pen\": %ld}", b ? ", " : "", b, right, v.pen().x);
    }
    json += "]\n}\n";
  }
  writeText(outDir + "\\spots.json", json);
  std::printf("spot values written\n");
  return 0;
}

// ---------------------------------------------------------------------------------------------

int main(int argc, char** argv) {
  if (argc >= 2 && std::strcmp(argv[1], "info") == 0) {
    std::printf("%s\n", machineSettingsJson().c_str());
    return 0;
  }
  if (argc == 4 && std::strcmp(argv[1], "cases") == 0) return runCases(argv[2], argv[3]);
  if (argc == 3 && std::strcmp(argv[1], "fonts") == 0) return runFonts(argv[2]);
  if (argc == 3 && std::strcmp(argv[1], "spots") == 0) return runSpots(argv[2]);
  std::fprintf(stderr,
               "usage: gdi-capture cases <case-list> <out-dir> | fonts <out-dir> | spots <out-dir> | info\n");
  return 1;
}
