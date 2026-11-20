// easy68k-mac: simio.cpp - the engine side of the I/O window (TsimIO,
// simIOu.cpp).
//
// Most methods only forward to the host (shim/host.h).  The ones that decide
// what the 68000 program sees are ported here from simIOu.cpp, statement by
// statement, with the drawing calls replaced by host imports:
//   - keyboard input: charIn, textIn, FormKeyPress (simIOu.cpp:1278-1416)
//   - key state for task 19 and key interrupts (simIOu.cpp:417-464, 584-632)
//   - mouse state for task 61 and mouse interrupts (simIOu.cpp:636-793)
//   - the result handling of a serial read (simIOu.cpp:2300-2333)
//   - the file dialog of task 58 (simIOu.cpp:468-563)
#include "extern.h"
#include "SIM68Ku.h"
#include "simIOu.h"
#include "hardwareu.h"
#include "host.h"
#include "runloop.h"

extern AnsiString errstr; // var.h

static TsimIO theSimIO;
TsimIO *simIO = &theSimIO;

// simIOu.cpp:28-36, 66-68
static char *userBuf;      // pointer to user buffer
static long *inputLength;  // length of input
static long *inputNumber;  // number input
static char *inputCh;      // character input
static const int KEYBUF_SIZE = 256;
static char keyBuf[KEYBUF_SIZE];
static int keyI;           // key index
static bool charInput = false; // true if char input
static bool keys[256];
uchar keyDownCode = 0;     // used by Trap #15,19
uchar keyUpCode = 0;

TsimIOBitmap::TsimIOBitmap() : Canvas(new TsimIOCanvas(FONT_TARGET_IO_BACKBUFFER)) {}

TsimIO::TsimIO() : fullScreen(false), BackBuffer(new TsimIOBitmap()), Font(new TFont(FONT_TARGET_IO_WINDOW)) {}

// ---------------------------------------------------------------------------
// text output: forwarded
// ---------------------------------------------------------------------------
void TsimIO::charOut(char ch) { host_io_charOut((unsigned char)ch); }
void TsimIO::textOut(const AnsiString &str) { host_io_textOut(str.c_str(), str.Length()); }
void TsimIO::textOutCR(const AnsiString &str) { host_io_textOutCR(str.c_str(), str.Length()); }
void TsimIO::clear() { host_io_clear(); }
void TsimIO::gotorc(int r, int c) { host_io_gotorc(r, c); }
void TsimIO::getrc(short *d1) { host_io_getrc(d1); }
void TsimIO::getCharAt(ushort r, ushort c, char *d1) { host_io_getCharAt(r, c, d1); }
void TsimIO::setFontProperties(int c, int s) { host_io_setFontProperties(c, s); }
void TsimIO::scrollRect(ushort r, ushort c, ushort h, ushort w, ushort dir) { host_io_scrollRect(r, c, h, w, dir); }
void TsimIO::doCRLF() { host_io_doCRLF(); }
void TsimIO::Show() { host_io_show(); }
void TsimIO::BringToFront() { host_io_bringToFront(); }
void TsimIO::Invalidate() { host_io_invalidate(); }

// erase prompt                                              (simIOu.cpp:1439)
void TsimIO::erasePrompt() {
  if (inputPrompt) {        // if input prompt wanted
    host_io_prompt(0);      // prompt->Enabled = false;  stop display of prompt
    host_io_erasePrompt();  // Canvas->TextOutA(promptX, textY, " ");
  }
}

// ---------------------------------------------------------------------------
//  charIn
//  get one character from keyboard                          (simIOu.cpp:1278)
// ---------------------------------------------------------------------------
void TsimIO::charIn(char *ch) {
  try {
    // The original passes the addresses of two local variables to textIn(),
    // which stores them in userBuf / inputLength for later.  They are never
    // used while charInput is true; static here so that they stay valid.
    static char str[2];
    static long size;
    if (pendingKey) { // if key already pressed
      *ch = pendingKey;
      if (keyboardEcho) {
        if (pendingKey != '\b') // if not backspace
          charOut(pendingKey);
        if (pendingKey == '\r') // if CR
          charOut('\n');        // do LF
      }
      pendingKey = 0; // clear pendingKey
      return;
    }
    inputCh = ch; // location to save input char
    charInput = true;
    textIn(str, &size, NULL);
  } catch (...) {
    Form1->Message->Lines->Add(errstr.sprintf("Error in charIn"));
    return;
  }
}

// ---------------------------------------------------------------------------
// textIn
// Read keyboard string into str (max 80) set size
// inNum: NULL = leave data as string in buffer
//     address = convert string to number and store at address
//             The conversion happens in FormKeyPress (below)  (simIOu.cpp:1309)
// ---------------------------------------------------------------------------
void TsimIO::textIn(char *str, long *size, long *inNum) {
  try {
    userBuf = str;        // point userBuf at users input buffer
    inputLength = size;   // point to size
    inputNumber = inNum;  // for numeric input
    keyI = 0;             // clear key index
    inputMode = true;     // enable keyboard input
    if (pendingKey) {     // if key already pressed
      FormKeyPress(this, pendingKey);
      pendingKey = 0;     // clear pendingKey
    }

    if (inputPrompt) {    // if input prompt wanted
      host_io_prompt(2);  // prompt->Enabled = true; promptVisible = true;
    }
    simIO->Show();        // display input form
  } catch (...) {
    Form1->Message->Lines->Add(errstr.sprintf("Error in textIn"));
    return;
  }
}

// ---------------------------------------------------------------------------
// A character arrived from the keyboard (WM_CHAR)            (simIOu.cpp:1334)
// ---------------------------------------------------------------------------
void TsimIO::FormKeyPress(TObject *, char &Key) {
  const char VK_BACK = 0x08;
  try {
    if (inputMode) {
      // if Enter key, limit reached or char input
      if (Key == '\r' || keyI >= 79 || charInput) {
        erasePrompt();
        if (charInput) {
          *inputCh = Key; // get key
          charInput = false;
          if (keyboardEcho) {
            charOut(Key);
            if (Key == '\r' && inputLFdisplay) // if CR and LF display wanted
              charOut('\n');                   // do LF
            this->Invalidate();
          }
        } else {
          doCRLF();            // display CRLF
          keyBuf[keyI] = '\0'; // terminate input buffer
          if (inputNumber == NULL) // if string input
          {
            for (int i = 0; i <= keyI; i++) // put string in 68000 memory at userBuf
              mem_put(keyBuf[i], (int)&userBuf[i] - (int)&memory[0], BYTE_MASK);
            *inputLength = keyI; // length of input string to D1
          } else {               // else numeric input
            strcpy(inputBuf, keyBuf);      // copy to sim68K inputBuf
            *inputLength = keyI;           // length of input string to D1
            *inputNumber = atoi(inputBuf); // convert string to int
          }
        }
        inputMode = false; // disable input mode
        if (trace) {       // if tracing
          Form1->setMenuActive(); // enable debug commands
          Hardware->enable();
          scrshow();         // update register display
          Form1->SetFocus(); // bring Form1 to top
        }
      } else if (Key == VK_BACK) { // if Backspace key
        keyI--;                    // remove one char from buffer
        if (keyI < 0)
          keyI = 0;
        else {
          erasePrompt();
          keyBuf[keyI] = '\0'; // temporarily terminate input buffer
          // gotorc(row,col-1); if (keyboardEcho) erase visible char; Invalidate();
          host_io_inputBackspace(keyboardEcho ? 1 : 0);
          if (inputPrompt)     // if input prompt wanted
            host_io_prompt(1); // display prompt
        }
      } else {
        keyBuf[keyI++] = Key; // get key
        keyBuf[keyI] = '\0';  // temporarily terminate input buffer
        host_io_prompt(0);    // temporarily stop display of prompt
        // if (keyboardEcho) { display input char; write it to the output log }
        // gotorc(row,col+1); Invalidate();
        host_io_inputEcho((unsigned char)keyBuf[keyI - 1], keyboardEcho ? 1 : 0);
        if (inputPrompt)      // if input prompt wanted
          host_io_prompt(1);  // display prompt
      }
    } else {
      pendingKey = Key;
    }
  } catch (...) {
    Form1->Message->Lines->Add(errstr.sprintf("Error in FormKeyPress"));
    return;
  }
}

// ---------------------------------------------------------------------------
// key state
// ---------------------------------------------------------------------------
// simIOu.cpp:417.  Key is the Windows virtual-key code.  The rest of the
// original handler (Ctrl+Tab, Alt+Enter, Shift+Insert, all skipped when
// disableKeyCommands) is window management and stays with the host.
void TsimIO::FormKeyDown(int Key) {
  try {
    keys[(uchar)Key] = true; // track key press
    keyDownCode = (char)Key; // save code for use by trap task #19
    if (keyDownIRQ) Hardware->IRQprocess(keyDownIRQ);
  } catch (...) {
    Form1->Message->Lines->Add(errstr.sprintf("Error in FormKeyDown"));
    return;
  }
}

// simIOu.cpp:452
void TsimIO::FormKeyUp(int Key) {
  try {
    keys[(uchar)Key] = false; // track key press
    keyUpCode = (char)Key;
    if (keyUpIRQ) Hardware->IRQprocess(keyUpIRQ);
  } catch (...) {
    Form1->Message->Lines->Add(errstr.sprintf("Error in FormKeyUp"));
    return;
  }
}

// return in codes as $00 if key up, $FF if key down (4 bytes)
// or return key code of last keypress                        (simIOu.cpp:584)
void TsimIO::getKeyState(long *codes) {
  long code = *codes;
  long keyState = 0;

  if (code == 0) { // if request scan code of last keypress
    code = (keyUpCode << 16) + keyDownCode;
    *codes = code;
    return;
  }

  if (keys[(uchar)code]) keyState = 0xFF;
  code = code >> 8;
  if (keys[(uchar)code]) keyState += 0xFF00;
  code = code >> 8;
  if (keys[(uchar)code]) keyState += 0xFF0000;
  code = code >> 8;
  if (keys[(uchar)code]) keyState += 0xFF000000;
  *codes = keyState;
}

// simIOu.cpp:621
void TsimIO::clearKeys() {
  keyDownCode = 0;
  keyUpCode = 0;
  for (int i = 0; i < 256; i++) keys[i] = false;
}

// ---------------------------------------------------------------------------
// mouse state
// ---------------------------------------------------------------------------
// simIOu.cpp:636
void TsimIO::FormMouseDown(int Shift, int X, int Y) {
  mouseX = X;
  mouseY = Y;
  mouseXDown = X;
  mouseYDown = Y;
  mouseLeft = mouseLeftDown = (Shift & ssLeft) != 0;
  mouseRight = mouseRightDown = (Shift & ssRight) != 0;
  mouseMiddle = mouseMiddleDown = (Shift & ssMiddle) != 0;
  mouseDouble = mouseDoubleDown = (Shift & ssDouble) != 0;
  keyShift = keyShiftDown = (Shift & ssShift) != 0;
  keyAlt = keyAltDown = (Shift & ssAlt) != 0;
  keyCtrl = keyCtrlDown = (Shift & ssCtrl) != 0;

  if (mouseDownIRQ) Hardware->IRQprocess(mouseDownIRQ);
}

// simIOu.cpp:703
void TsimIO::FormMouseUp(int Shift, int X, int Y) {
  mouseX = X;
  mouseY = Y;
  mouseXUp = X;
  mouseYUp = Y;
  mouseLeft = mouseLeftUp = (Shift & ssLeft) != 0;
  mouseRight = mouseRightUp = (Shift & ssRight) != 0;
  mouseMiddle = mouseMiddleUp = (Shift & ssMiddle) != 0;
  mouseDouble = mouseDoubleUp = (Shift & ssDouble) != 0;
  keyShift = keyShiftUp = (Shift & ssShift) != 0;
  keyAlt = keyAltUp = (Shift & ssAlt) != 0;
  keyCtrl = keyCtrlUp = (Shift & ssCtrl) != 0;

  if (mouseUpIRQ) Hardware->IRQprocess(mouseUpIRQ);
}

// simIOu.cpp:769
void TsimIO::FormMouseMove(int Shift, int X, int Y) {
  mouseX = X;
  mouseY = Y;
  keyShift = (Shift & ssShift) != 0;
  keyAlt = (Shift & ssAlt) != 0;
  keyCtrl = (Shift & ssCtrl) != 0;

  if (mouseMoveIRQ) Hardware->IRQprocess(mouseMoveIRQ);
}

// ---------------------------------------------------------------------------
// window
// ---------------------------------------------------------------------------
void TsimIO::setWindowSize(ushort width, ushort height) { host_io_setWindowSize(width, height); }
void TsimIO::getWindowSize(ushort &width, ushort &height) { host_io_getWindowSize(&width, &height); }
void TsimIO::setupWindow() { host_io_setupWindow(fullScreen ? 1 : 0); }

// ---------------------------------------------------------------------------
// TRAP #15 task 58: file dialog                              (simIOu.cpp:468)
//
// The original shows a modal dialog in the middle of this function.  It is
// cut in two at OpenDialogIO->Execute() / SaveDialogIO->Execute(): the first
// half asks the host for the dialog (host_file_dialog) and the instruction
// waits (SIM_WAIT_HOST); fileDialogReply() is the second half.
// ---------------------------------------------------------------------------
static struct {
  long *mode;
  short *result;
  int A3;
  char *inPath;
  int dialog; // 0 = open, 1 = save
} fileDialog;
// The FileName properties of the two dialog components.  They persist between
// calls, and the original reads OpenDialogIO->FileName in the save case too.
static AnsiString OpenDialogIO_FileName, SaveDialogIO_FileName;

void TsimIO::displayFileDialog(long *mode, int A1, int A2, int A3, short *result) {
  char title[256]; // title buffer
  char ext[256];   // extensions
  char path[256];  // file path
  char *inTitle, *inExt, *inPath;
  AnsiString filter;

  clearKeys(); // key up/down array is cleared because dialog intercepts key presses

  *result = F_SUCCESS; // default to success
  if (A1 != 0) {
    inTitle = &memory[A1 & ADDRMASK];
    strncpy(title, inTitle, 255); // make copy of string so we can terminate it
  } else
    title[0] = '\0';
  title[255] = '\0'; // Terminated!, in case it wasn't already

  if (A2 != 0) {
    inExt = &memory[A2 & ADDRMASK];
    strncpy(ext, inExt, 255); // make copy of string so we can terminate it
  } else
    ext[0] = '\0';
  ext[255] = '\0'; // Terminated!, in case it wasn't already

  inPath = &memory[A3 & ADDRMASK];
  strncpy(path, inPath, 255); // make copy of string so we can terminate it
  path[255] = '\0';           // Terminated!, in case it wasn't already

  if (ext[0] != '\0') // if extension list present
    filter = AnsiString(ext) + "|" + AnsiString(ext);

  fileDialog.mode = mode;
  fileDialog.result = result;
  fileDialog.A3 = A3;
  fileDialog.inPath = inPath;

  switch (*mode) {
    case 0: // 'Open' dialog
      OpenDialogIO_FileName = (path[0] != '\0') ? AnsiString(path) : AnsiString(""); // if file path present
      fileDialog.dialog = 0;
      easy68k_host_request_pending = true;
      host_file_dialog(0, title, filter.c_str(), OpenDialogIO_FileName.c_str()); // OpenDialogIO->Execute()
      break;

    case 1: // 'Save' dialog
      if (path[0] != '\0') // if file path present
        SaveDialogIO_FileName = AnsiString(path);
      else
        OpenDialogIO_FileName = ""; // (sic: the original clears the OPEN dialog's name here)
      fileDialog.dialog = 1;
      easy68k_host_request_pending = true;
      host_file_dialog(1, title, filter.c_str(), SaveDialogIO_FileName.c_str()); // SaveDialogIO->Execute()
      break;
  }
}

void TsimIO::fileDialogReply(bool accepted, const char *chosen) {
  if (!easy68k_host_request_pending) return;
  easy68k_host_request_pending = false;
  long *mode = fileDialog.mode;
  short *result = fileDialog.result;
  char *inPath = fileDialog.inPath;
  AnsiString fileName;

  if (accepted) {
    // Execute() returned true: the dialog's FileName is the chosen file.
    AnsiString &dialogFileName = (fileDialog.dialog == 0) ? OpenDialogIO_FileName : SaveDialogIO_FileName;
    dialogFileName = AnsiString(chosen ? chosen : "");
    fileName = OpenDialogIO_FileName; // get filename (sic, also for the save dialog)
    int nameLength = fileName.Length();
    if (nameLength > 255) // limit length
      nameLength = 255;
    // if buffer overflows 68000 memory
    if ((unsigned int)(fileDialog.A3 + nameLength) > MEMSIZE) {
      *result = F_ERROR; // error
      return;
    }
    strncpy(inPath, dialogFileName.c_str(), 255);
    inPath[255] = '\0';
    *mode = 1; // d1 = 1 if user opens file
  } else
    *mode = 0; // d1 = 0 if user cancels
}

// ---------------------------------------------------------------------------
// sound, graphics: forwarded
// ---------------------------------------------------------------------------
void TsimIO::ResetSounds() { host_io_resetSounds(); }
void TsimIO::playSound(char *fileName, short *result) { host_io_playSound(fileName, result); }
void TsimIO::loadSound(char *fileName, int waveIndex) { host_io_loadSound(fileName, waveIndex); }
void TsimIO::playSoundMem(int waveIndex, short *result) { host_io_playSoundMem(waveIndex, result); }
void TsimIO::controlSound(int control, int waveIndex, short *result) { host_io_controlSound(control, waveIndex, result); }
void TsimIO::playSoundDX(char *fileName, short *result) { host_io_playSoundDX(fileName, result); }
void TsimIO::loadSoundDX(char *fileName, int waveIndex, short *result) { host_io_loadSoundDX(fileName, waveIndex, result); }
void TsimIO::playSoundMemDX(int waveIndex, short *result) { host_io_playSoundMemDX(waveIndex, result); }
void TsimIO::controlSoundDX(int control, int waveIndex, short *result) { host_io_controlSoundDX(control, waveIndex, result); }

void TsimIO::setLineColor(int c) { host_io_setLineColor(c); }
void TsimIO::setFillColor(int c) { host_io_setFillColor(c); }
void TsimIO::drawPixel(int x, int y) { host_io_drawPixel(x, y); }
int TsimIO::getPixel(int x, int y) { return host_io_getPixel(x, y); }
void TsimIO::line(int x1, int y1, int x2, int y2) { host_io_line(x1, y1, x2, y2); }
void TsimIO::lineTo(int x, int y) { host_io_lineTo(x, y); }
void TsimIO::moveTo(int x, int y) { host_io_moveTo(x, y); }
void TsimIO::getXY(short *x, short *y) { host_io_getXY(x, y); }
void TsimIO::rectangle(int x1, int y1, int x2, int y2) { host_io_rectangle(x1, y1, x2, y2); }
void TsimIO::ellipse(int x1, int y1, int x2, int y2) { host_io_ellipse(x1, y1, x2, y2); }
void TsimIO::floodFill(int x, int y) { host_io_floodFill(x, y); }
void TsimIO::unfilledRectangle(int x1, int y1, int x2, int y2) { host_io_unfilledRectangle(x1, y1, x2, y2); }
void TsimIO::unfilledEllipse(int x1, int y1, int x2, int y2) { host_io_unfilledEllipse(x1, y1, x2, y2); }
void TsimIO::setDrawingMode(int m) { host_io_setDrawingMode(m); }
void TsimIO::setPenWidth(int w) { host_io_setPenWidth(w); }
void TsimIO::FormPaint(TObject *) { host_io_formPaint(); }
void TsimIO::drawText(const AnsiString &str, int x, int y) { host_io_drawText(str.c_str(), str.Length(), x, y); }

// ---------------------------------------------------------------------------
// serial ports
// ---------------------------------------------------------------------------
void TsimIO::initComm(int cid, char *portName, short *result) { host_io_initComm(cid, portName, result); }
void TsimIO::setCommParams(int cid, int settings, short *result) { host_io_setCommParams(cid, settings, result); }

// simIOu.h:46: receive buffer.  It is not cleared between reads, and the
// strcpy below copies up to its first NUL - so bytes of an earlier, longer
// read can follow the new ones.  Kept as in the original.
static char InBuff[MAX_SERIAL_IN + 1];

// simIOu.cpp:2300.  The device read (ReadFile) is the host's part.
void TsimIO::readComm(int cid, uchar *n, char *str, short *result) {
  *result = 0; // 0 is success

  int dwBytesRead = host_io_commRead(cid, InBuff, *n);
  if (dwBytesRead == -1) { // if invalid CID
    *result = 1;
    return;
  }
  if (dwBytesRead == -3) { // if comm port not initialized
    *result = 3;
    return;
  }
  if (dwBytesRead < 0) { // if read error
    *result = 2;
    return;
  }
  if (dwBytesRead > MAX_SERIAL_IN) dwBytesRead = MAX_SERIAL_IN;

  if (dwBytesRead) {
    str[dwBytesRead] = 0; // null terminate the string
  }
  if (dwBytesRead < (int)*n) // if timeout
    *result = 4;
  *n = (uchar)dwBytesRead;

  if (memoryMapCheck((maptype)(Invalid | Read | Rom), (str - memory), (int)dwBytesRead) == SUCCESS)
    strcpy(str, InBuff); // stores string only to writable memory
}

void TsimIO::sendComm(int cid, uchar *n, char *str, short *result) { host_io_sendComm(cid, n, str, result); }

// ---------------------------------------------------------------------------
// network: forwarded
// ---------------------------------------------------------------------------
void TsimIO::createNetClient(int settings, char *server, int *result) { host_io_createNetClient(settings, server, result); }
void TsimIO::createNetServer(int settings, int *result) { host_io_createNetServer(settings, result); }
void TsimIO::sendNet(int settings, char *data, char *remoteIP, int *count, int *result) {
  host_io_sendNet(settings, data, remoteIP, count, result);
}
void TsimIO::receiveNet(int settings, char *buffer, int *count, char *senderIP, int *result) {
  host_io_receiveNet(settings, buffer, count, senderIP, result);
}
void TsimIO::sendPortNet(long *D0, long *D1, char *data, char *remoteIP) { host_io_sendPortNet(D0, D1, data, remoteIP); }
void TsimIO::receivePortNet(long *D0, long *D1, char *buffer, char *senderIP) {
  host_io_receivePortNet(D0, D1, buffer, senderIP);
}
void TsimIO::closeNetConnection(int closeIP, int *result) { host_io_closeNetConnection(closeIP, result); }
void TsimIO::getLocalIP(char *localIP, int *result) { host_io_getLocalIP(localIP, result); }
