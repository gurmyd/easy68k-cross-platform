// easy68k-mac: stand-in for the original simIOu.h (the I/O window, class
// TsimIO).  Every method the core calls exists here with the original
// signature.  Drawing, sound, serial ports and networking are forwarded to the
// host (shim/host.h).  The parts of the original class that decide
// CPU-visible results stay in the engine: the keyboard-input state machine
// (textIn, charIn, FormKeyPress), the key and mouse state read by TRAP #15
// tasks 19 and 61, the bookkeeping of a serial read, and what the file dialog
// writes to 68000 memory.  Implemented in shim/simio.cpp.
#ifndef EASY68K_SIMIOU_H
#define EASY68K_SIMIOU_H

#include "vcl.h"
#include "def.h"

class TsimIOCanvas {
public:
  explicit TsimIOCanvas(int fontId) : Font(new TFont(fontId)) {}
  TFont *Font;
};
class TsimIOBitmap {
public:
  TsimIOBitmap();
  TsimIOCanvas *Canvas;
};

class TsimIO : public TObject {
public:
  TsimIO();

  bool fullScreen;          // public data member of the original class
  TsimIOBitmap *BackBuffer; // only ->Canvas->Font is used (initSim)
  TFont *Font;              // the font of the form (initSim)

  // ---- text (simIOu.cpp:811-1275)
  void charOut(char ch);
  void textOut(const AnsiString &str);
  void textOutCR(const AnsiString &str);
  void clear();
  void gotorc(int r, int c);
  void getrc(short *d1);
  void getCharAt(ushort r, ushort c, char *d1);
  void setFontProperties(int c, int s);
  void scrollRect(ushort r, ushort c, ushort h, ushort w, ushort dir);
  void doCRLF();

  // ---- keyboard input (simIOu.cpp:1278-1452)
  void charIn(char *ch);
  void textIn(char *str, long *size, long *inNum);
  void FormKeyPress(TObject *Sender, char &Key);
  void erasePrompt();
  void Show();
  void BringToFront();
  void Invalidate();

  // ---- key and mouse state (simIOu.cpp:417-464, 584-793)
  void FormKeyDown(int Key);
  void FormKeyUp(int Key);
  void getKeyState(long *codes);
  void clearKeys();
  void FormMouseDown(int Shift, int X, int Y);
  void FormMouseUp(int Shift, int X, int Y);
  void FormMouseMove(int Shift, int X, int Y);

  // ---- window (simIOu.cpp:187-376)
  void setWindowSize(ushort width, ushort height);
  void getWindowSize(ushort &width, ushort &height);
  void setupWindow();

  // ---- file dialog (simIOu.cpp:468-563)
  void displayFileDialog(long *mode, int A1, int A2, int A3, short *result);
  // the part of displayFileDialog after OpenDialogIO->Execute() returned
  void fileDialogReply(bool accepted, const char *fileName);

  // ---- sound (simIOu.cpp:1593-1846)
  void ResetSounds();
  void playSound(char *fileName, short *result);
  void loadSound(char *fileName, int waveIndex);
  void playSoundMem(int waveIndex, short *result);
  void controlSound(int control, int waveIndex, short *result);
  void playSoundDX(char *fileName, short *result);
  void loadSoundDX(char *fileName, int waveIndex, short *result);
  void playSoundMemDX(int waveIndex, short *result);
  void controlSoundDX(int control, int waveIndex, short *result);

  // ---- graphics (simIOu.cpp:1852-2047)
  void setLineColor(int c);
  void setFillColor(int c);
  void drawPixel(int x, int y);
  int getPixel(int x, int y);
  void line(int x1, int y1, int x2, int y2);
  void lineTo(int x, int y);
  void moveTo(int x, int y);
  void getXY(short *x, short *y);
  void rectangle(int x1, int y1, int x2, int y2);
  void ellipse(int x1, int y1, int x2, int y2);
  void floodFill(int x, int y);
  void unfilledRectangle(int x1, int y1, int x2, int y2);
  void unfilledEllipse(int x1, int y1, int x2, int y2);
  void setDrawingMode(int m);
  void setPenWidth(int w);
  void FormPaint(TObject *Sender);
  void drawText(const AnsiString &str, int x, int y);

  // ---- serial ports (simIOu.cpp:2068-2369)
  void initComm(int cid, char *portName, short *result);
  void setCommParams(int cid, int settings, short *result);
  void readComm(int cid, uchar *n, char *str, short *result);
  void sendComm(int cid, uchar *n, char *str, short *result);

  // ---- network (simIOu.cpp:2378-2464)
  void createNetClient(int settings, char *server, int *result);
  void createNetServer(int settings, int *result);
  void sendNet(int settings, char *data, char *remoteIP, int *count, int *result);
  void receiveNet(int settings, char *buffer, int *count, char *senderIP, int *result);
  void sendPortNet(long *D0, long *D1, char *data, char *remoteIP);
  void receivePortNet(long *D0, long *D1, char *buffer, char *senderIP);
  void closeNetConnection(int closeIP, int *result);
  void getLocalIP(char *localIP, int *result);
};

extern TsimIO *simIO;

// Shift-state bits for FormMouseDown / FormMouseUp / FormMouseMove: the
// members of the VCL set TShiftState that the original handlers test.
enum {
  ssShift = 0x01, ssAlt = 0x02, ssCtrl = 0x04,
  ssLeft = 0x08, ssRight = 0x10, ssMiddle = 0x20, ssDouble = 0x40
};

#endif
