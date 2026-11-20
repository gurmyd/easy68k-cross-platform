// easy68k-mac: host-imports.js - Emscripten JavaScript library with the
// implementation of every import declared in shim/host.h.
//
// Each import forwards to one method of the host object (Module.host, the
// "host" argument of createSim() in sim68k.mjs, already completed with
// defaults for the methods a host leaves out).  This file does the pointer
// work so that host methods only see plain values:
//   * text and data arrive as Uint8Array copies (bytes, never decoded);
//   * a result the original wrote through a pointer into a 68000 register is
//     written here with exactly the width of that pointer, and only if the
//     host method returned a number ("undefined" = leave the register alone);
//   * buffers inside 68000 memory are passed as 68000 addresses; the host
//     reads and writes them through sim.memory.
//
// The method list with full documentation is the SimHost typedef in sim68k.mjs.

addToLibrary({
  // ---- helpers ---------------------------------------------------------------
  $simHost: () => Module['host'],
  // n bytes at ptr, as a copy
  $simBytes: (ptr, n) => HEAPU8.slice(ptr, ptr + n),
  // the NUL-terminated bytes at ptr, as a copy (without the NUL)
  $simCString: (ptr) => {
    let end = ptr;
    while (HEAPU8[end] !== 0) end++;
    return HEAPU8.slice(ptr, end);
  },
  // pointer into the 68000 memory array -> 68000 address
  $simAddress: (ptr) => (ptr - Module['simMemoryBase']) >>> 0,
  $simPut8: (ptr, v) => { if (typeof v === 'number') HEAP8[ptr] = v; },
  $simPut16: (ptr, v) => { if (typeof v === 'number') HEAP16[ptr >> 1] = v; },
  $simPut32: (ptr, v) => { if (typeof v === 'number') HEAP32[ptr >> 2] = v; },

  // ---- main window -------------------------------------------------------------
  host_message__deps: ['$simHost', '$simBytes'],
  host_message: (text, length) => { simHost().message(simBytes(text, length)); },
  host_messages_clear__deps: ['$simHost'],
  host_messages_clear: () => { simHost().messagesClear(); },
  host_alert__deps: ['$simHost', '$simCString'],
  host_alert: (title, text) => { simHost().alert(simCString(title), simCString(text)); },
  host_show_regs__deps: ['$simHost'],
  host_show_regs: () => { simHost().registersShown(); },
  host_menu_state__deps: ['$simHost'],
  host_menu_state: (state) => { simHost().menuState(state); },
  host_focus_main__deps: ['$simHost'],
  host_focus_main: () => { simHost().focusMain(); },
  host_autotrace_timer__deps: ['$simHost'],
  host_autotrace_timer: (enabled) => { simHost().autoTraceTimer(enabled !== 0); },
  host_key_commands__deps: ['$simHost'],
  host_key_commands: (enabled) => { simHost().keyCommands(enabled !== 0); },
  host_option_changed__deps: ['$simHost'],
  host_option_changed: (option, value) => { simHost().optionChanged(option, value); },
  host_save_settings__deps: ['$simHost'],
  host_save_settings: () => { simHost().saveSettings(); },
  host_caption__deps: ['$simHost', '$simBytes'],
  host_caption: (text, length) => { simHost().caption(simBytes(text, length)); },
  host_repaint__deps: ['$simHost'],
  host_repaint: (what) => { simHost().repaint(what); },
  host_mem_live_paint__deps: ['$simHost'],
  host_mem_live_paint: (addr) => { simHost().memoryLivePaint(addr >>> 0); },
  host_font_assign__deps: ['$simHost'],
  host_font_assign: (target, source) => { simHost().fontAssign(target, source); },

  // ---- hardware window ---------------------------------------------------------
  host_hw_update__deps: ['$simHost'],
  host_hw_update: () => { simHost().hardwareUpdate(); },
  host_hw_state__deps: ['$simHost'],
  host_hw_state: (enabled, autoIRQ) => { simHost().hardwareState(enabled !== 0, autoIRQ !== 0); },
  host_hw_timer__deps: ['$simHost'],
  host_hw_timer: (level, enabled, intervalMs) => { simHost().hardwareTimer(level, enabled !== 0, intervalMs >>> 0); },
  host_hw_show__deps: ['$simHost'],
  host_hw_show: () => { simHost().hardwareShow(); },
  host_hw_controls__deps: ['$simHost'],
  host_hw_controls: () => { simHost().hardwareControls(); },

  // ---- log ---------------------------------------------------------------------
  host_log_write__deps: ['$simHost', '$simBytes'],
  host_log_write: (data, length) => { simHost().logWrite(simBytes(data, length)); },
  host_log_state__deps: ['$simHost'],
  host_log_state: (logging) => { simHost().logState(logging !== 0); },
  host_output_log_write__deps: ['$simHost', '$simBytes'],
  host_output_log_write: (data, length) => { simHost().outputLogWrite(simBytes(data, length)); },

  // ---- clock -------------------------------------------------------------------
  host_time_centiseconds__deps: ['$simHost'],
  host_time_centiseconds: () => simHost().timeCentiseconds() >>> 0,

  // ---- host files --------------------------------------------------------------
  host_file_open__deps: ['$simHost', '$simCString'],
  host_file_open: (name, mode) => {
    const handle = simHost().fileOpen(simCString(name), mode);
    return (typeof handle === 'number' && handle > 0) ? handle : 0;
  },
  host_file_read__deps: ['$simHost'],
  host_file_read: (handle, buffer, n) => {
    const data = simHost().fileRead(handle, n);
    if (!data) return -1;
    const count = Math.min(data.length, n);
    HEAPU8.set(count === data.length ? data : data.subarray(0, count), buffer);
    return count;
  },
  host_file_write__deps: ['$simHost', '$simBytes'],
  host_file_write: (handle, buffer, n) => {
    const count = simHost().fileWrite(handle, simBytes(buffer, n));
    return (typeof count === 'number') ? count : -1;
  },
  host_file_seek__deps: ['$simHost'],
  host_file_seek: (handle, offset, whence) => {
    const position = simHost().fileSeek(handle, offset, whence);
    return (typeof position === 'number' && position >= 0) ? position : -1;
  },
  host_file_close__deps: ['$simHost'],
  host_file_close: (handle) => (simHost().fileClose(handle) ? 0 : -1),
  host_file_remove__deps: ['$simHost', '$simCString'],
  host_file_remove: (name) => (simHost().fileRemove(simCString(name)) ? 0 : -1),
  host_file_dialog__deps: ['$simHost', '$simCString'],
  host_file_dialog: (mode, title, filter, fileName) => {
    simHost().fileDialog(mode, simCString(title), simCString(filter), simCString(fileName));
  },

  // ---- I/O window: text ----------------------------------------------------------
  host_io_charOut__deps: ['$simHost'],
  host_io_charOut: (ch) => { simHost().charOut(ch & 0xFF); },
  host_io_textOut__deps: ['$simHost', '$simBytes'],
  host_io_textOut: (text, length) => { simHost().textOut(simBytes(text, length)); },
  host_io_textOutCR__deps: ['$simHost', '$simBytes'],
  host_io_textOutCR: (text, length) => { simHost().textOutCR(simBytes(text, length)); },
  host_io_clear__deps: ['$simHost'],
  host_io_clear: () => { simHost().clear(); },
  host_io_getrc__deps: ['$simHost', '$simPut16'],
  host_io_getrc: (d1) => { simPut16(d1, simHost().getrc()); },
  host_io_gotorc__deps: ['$simHost'],
  host_io_gotorc: (row, col) => { simHost().gotorc(row, col); },
  host_io_setFontProperties__deps: ['$simHost'],
  host_io_setFontProperties: (color, style) => { simHost().setFontProperties(color, style); },
  host_io_getCharAt__deps: ['$simHost', '$simPut8'],
  host_io_getCharAt: (row, col, d1) => { simPut8(d1, simHost().getCharAt(row, col)); },
  host_io_scrollRect__deps: ['$simHost'],
  host_io_scrollRect: (row, col, height, width, direction) => { simHost().scrollRect(row, col, height, width, direction); },
  host_io_setWindowSize__deps: ['$simHost'],
  host_io_setWindowSize: (width, height) => { simHost().setWindowSize(width, height); },
  host_io_getWindowSize__deps: ['$simHost'],
  host_io_getWindowSize: (width, height) => {
    const size = simHost().getWindowSize();
    HEAPU16[width >> 1] = size ? size[0] : 640;
    HEAPU16[height >> 1] = size ? size[1] : 480;
  },
  host_io_setupWindow__deps: ['$simHost'],
  host_io_setupWindow: (fullScreen) => { simHost().setupWindow(fullScreen !== 0); },
  host_io_show__deps: ['$simHost'],
  host_io_show: () => { simHost().ioShow(); },
  host_io_bringToFront__deps: ['$simHost'],
  host_io_bringToFront: () => { simHost().ioBringToFront(); },
  host_io_prompt__deps: ['$simHost'],
  host_io_prompt: (mode) => { simHost().inputPrompt(mode); },
  host_io_erasePrompt__deps: ['$simHost'],
  host_io_erasePrompt: () => { simHost().erasePrompt(); },
  host_io_inputEcho__deps: ['$simHost'],
  host_io_inputEcho: (ch, echo) => { simHost().inputEcho(ch & 0xFF, echo !== 0); },
  host_io_inputBackspace__deps: ['$simHost'],
  host_io_inputBackspace: (echo) => { simHost().inputBackspace(echo !== 0); },
  host_io_doCRLF__deps: ['$simHost'],
  host_io_doCRLF: () => { simHost().doCRLF(); },
  host_io_invalidate__deps: ['$simHost'],
  host_io_invalidate: () => { simHost().invalidate(); },

  // ---- I/O window: graphics ------------------------------------------------------
  host_io_setLineColor__deps: ['$simHost'],
  host_io_setLineColor: (color) => { simHost().setLineColor(color); },
  host_io_setFillColor__deps: ['$simHost'],
  host_io_setFillColor: (color) => { simHost().setFillColor(color); },
  host_io_drawPixel__deps: ['$simHost'],
  host_io_drawPixel: (x, y) => { simHost().drawPixel(x, y); },
  host_io_getPixel__deps: ['$simHost'],
  host_io_getPixel: (x, y) => simHost().getPixel(x, y) | 0,
  host_io_line__deps: ['$simHost'],
  host_io_line: (x1, y1, x2, y2) => { simHost().line(x1, y1, x2, y2); },
  host_io_lineTo__deps: ['$simHost'],
  host_io_lineTo: (x, y) => { simHost().lineTo(x, y); },
  host_io_moveTo__deps: ['$simHost'],
  host_io_moveTo: (x, y) => { simHost().moveTo(x, y); },
  host_io_rectangle__deps: ['$simHost'],
  host_io_rectangle: (x1, y1, x2, y2) => { simHost().rectangle(x1, y1, x2, y2); },
  host_io_ellipse__deps: ['$simHost'],
  host_io_ellipse: (x1, y1, x2, y2) => { simHost().ellipse(x1, y1, x2, y2); },
  host_io_floodFill__deps: ['$simHost'],
  host_io_floodFill: (x, y) => { simHost().floodFill(x, y); },
  host_io_unfilledRectangle__deps: ['$simHost'],
  host_io_unfilledRectangle: (x1, y1, x2, y2) => { simHost().unfilledRectangle(x1, y1, x2, y2); },
  host_io_unfilledEllipse__deps: ['$simHost'],
  host_io_unfilledEllipse: (x1, y1, x2, y2) => { simHost().unfilledEllipse(x1, y1, x2, y2); },
  host_io_setDrawingMode__deps: ['$simHost'],
  host_io_setDrawingMode: (mode) => { simHost().setDrawingMode(mode); },
  host_io_setPenWidth__deps: ['$simHost'],
  host_io_setPenWidth: (width) => { simHost().setPenWidth(width); },
  host_io_formPaint__deps: ['$simHost'],
  host_io_formPaint: () => { simHost().formPaint(); },
  host_io_drawText__deps: ['$simHost', '$simBytes'],
  host_io_drawText: (text, length, x, y) => { simHost().drawText(simBytes(text, length), x, y); },
  host_io_getXY__deps: ['$simHost', '$simPut16'],
  host_io_getXY: (x, y) => {
    const position = simHost().getXY();
    if (position) { simPut16(x, position[0]); simPut16(y, position[1]); }
  },

  // ---- I/O window: sound ---------------------------------------------------------
  host_io_resetSounds__deps: ['$simHost'],
  host_io_resetSounds: () => { simHost().resetSounds(); },
  host_io_playSound__deps: ['$simHost', '$simCString', '$simPut16'],
  host_io_playSound: (fileName, result) => { simPut16(result, simHost().playSound(simCString(fileName))); },
  host_io_loadSound__deps: ['$simHost', '$simCString'],
  host_io_loadSound: (fileName, waveIndex) => { simHost().loadSound(simCString(fileName), waveIndex); },
  host_io_playSoundMem__deps: ['$simHost', '$simPut16'],
  host_io_playSoundMem: (waveIndex, result) => { simPut16(result, simHost().playSoundMem(waveIndex)); },
  host_io_controlSound__deps: ['$simHost', '$simPut16'],
  host_io_controlSound: (control, waveIndex, result) => { simPut16(result, simHost().controlSound(control, waveIndex)); },
  host_io_playSoundDX__deps: ['$simHost', '$simCString', '$simPut16'],
  host_io_playSoundDX: (fileName, result) => { simPut16(result, simHost().playSoundDX(simCString(fileName))); },
  host_io_loadSoundDX__deps: ['$simHost', '$simCString', '$simPut16'],
  host_io_loadSoundDX: (fileName, waveIndex, result) => { simPut16(result, simHost().loadSoundDX(simCString(fileName), waveIndex)); },
  host_io_playSoundMemDX__deps: ['$simHost', '$simPut16'],
  host_io_playSoundMemDX: (waveIndex, result) => { simPut16(result, simHost().playSoundMemDX(waveIndex)); },
  host_io_controlSoundDX__deps: ['$simHost', '$simPut16'],
  host_io_controlSoundDX: (control, waveIndex, result) => { simPut16(result, simHost().controlSoundDX(control, waveIndex)); },

  // ---- I/O window: serial ports ----------------------------------------------------
  host_io_initComm__deps: ['$simHost', '$simCString', '$simPut16'],
  host_io_initComm: (cid, portName, result) => { simPut16(result, simHost().initComm(cid, simCString(portName))); },
  host_io_setCommParams__deps: ['$simHost', '$simPut16'],
  host_io_setCommParams: (cid, settings, result) => { simPut16(result, simHost().setCommParams(cid, settings)); },
  host_io_commRead__deps: ['$simHost'],
  host_io_commRead: (cid, buffer, n) => {
    const data = simHost().commRead(cid, n);
    if (typeof data === 'number') return data < 0 ? data : -2;
    if (!data) return -3;
    const count = Math.min(data.length, n);
    HEAPU8.set(count === data.length ? data : data.subarray(0, count), buffer);
    return count;
  },
  host_io_sendComm__deps: ['$simHost', '$simBytes', '$simPut16'],
  host_io_sendComm: (cid, n, data, result) => {
    const count = HEAPU8[n];
    const reply = simHost().sendComm(cid, simBytes(data, count));
    if (reply) {
      simPut16(result, reply.result);
      if (typeof reply.sent === 'number') HEAPU8[n] = reply.sent;
    }
  },

  // ---- I/O window: network -----------------------------------------------------------
  host_io_createNetClient__deps: ['$simHost', '$simCString', '$simPut32'],
  host_io_createNetClient: (settings, server, result) => { simPut32(result, simHost().createNetClient(settings, simCString(server))); },
  host_io_createNetServer__deps: ['$simHost', '$simPut32'],
  host_io_createNetServer: (settings, result) => { simPut32(result, simHost().createNetServer(settings)); },
  host_io_sendNet__deps: ['$simHost', '$simAddress', '$simCString', '$simPut32'],
  host_io_sendNet: (settings, data, remoteIP, count, result) => {
    const reply = simHost().sendNet(settings, simAddress(data), simCString(remoteIP));
    if (reply) { simPut32(result, reply.result); simPut32(count, reply.count); }
  },
  host_io_receiveNet__deps: ['$simHost', '$simAddress', '$simPut32'],
  host_io_receiveNet: (settings, buffer, count, senderIP, result) => {
    const reply = simHost().receiveNet(settings, simAddress(buffer), simAddress(senderIP));
    if (reply) { simPut32(result, reply.result); simPut32(count, reply.count); }
  },
  host_io_sendPortNet__deps: ['$simHost', '$simAddress', '$simCString', '$simPut32'],
  host_io_sendPortNet: (d0, d1, data, remoteIP) => {
    const reply = simHost().sendPortNet(HEAP32[d1 >> 2], simAddress(data), simCString(remoteIP));
    if (reply) { simPut32(d0, reply.d0); simPut32(d1, reply.d1); }
  },
  host_io_receivePortNet__deps: ['$simHost', '$simAddress', '$simPut32'],
  host_io_receivePortNet: (d0, d1, buffer, senderIP) => {
    const reply = simHost().receivePortNet(HEAP32[d1 >> 2], simAddress(buffer), simAddress(senderIP));
    if (reply) { simPut32(d0, reply.d0); simPut32(d1, reply.d1); }
  },
  host_io_closeNetConnection__deps: ['$simHost', '$simPut32'],
  host_io_closeNetConnection: (closeIP, result) => { simPut32(result, simHost().closeNetConnection(closeIP)); },
  host_io_getLocalIP__deps: ['$simHost', '$simAddress', '$simPut32'],
  host_io_getLocalIP: (localIP, result) => { simPut32(result, simHost().getLocalIP(simAddress(localIP))); },
  host_net_closeSockets__deps: ['$simHost'],
  host_net_closeSockets: () => simHost().netCloseSockets() | 0,

  // ---- printer -----------------------------------------------------------------------
  host_prn_beginDoc__deps: ['$simHost'],
  host_prn_beginDoc: () => { simHost().printerBeginDoc(); },
  host_prn_endDoc__deps: ['$simHost'],
  host_prn_endDoc: () => { simHost().printerEndDoc(); },
  host_prn_metric__deps: ['$simHost'],
  host_prn_metric: (which) => simHost().printerMetric(which) | 0,
  host_prn_textOut__deps: ['$simHost'],
  host_prn_textOut: (x, y, ch) => { simHost().printerTextOut(x, y, ch & 0xFF); },
});
