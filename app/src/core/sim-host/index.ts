// The composed simulator host (ARCHITECTURE.md 3.3.1): ten parts, one flat object.
//
// The engine wants one object with one method per import (`SimHost`, 93 methods). The application
// builds that object from ten parts - the UI bridge, the hardware model, the log service, the
// program files, the output device (twice: text and graphics), sound, serial, network, printer -
// and gives the same object to every engine instance it creates.
//
// Only the methods of each part's HOST INTERFACE are taken. A part is a class with more members
// than the host needs (`resetToStartup`, `subscribe`, `state` ...), several parts have members of
// the same name, and the output device serves as two parts at once; binding "every member" would
// collide. The lists below name the host methods of each part, and the compiler checks each list
// against its interface in both directions.
//
// Owner: SH8.

import type {
  HostFiles,
  HostHardware,
  HostIoGraphics,
  HostIoText,
  HostLog,
  HostMain,
  HostNet,
  HostPrinter,
  HostSerial,
  HostSound,
  SimHost,
  SimHostParts,
} from '../../contracts';

export type { SimHostParts } from '../../contracts';

/** Every key of `Part`, each exactly once: a missing or an extra name does not compile. */
function methodsOf<Part>() {
  return <const Names extends readonly (keyof Part)[]>(
    names: Names & ([keyof Part] extends [Names[number]] ? unknown : never),
  ): Names => names;
}

/** The host methods each part contributes, in the order of contracts/host.ts. */
export const HOST_PART_METHODS = {
  main: methodsOf<HostMain>()([
    'message',
    'messagesClear',
    'alert',
    'registersShown',
    'menuState',
    'focusMain',
    'autoTraceTimer',
    'keyCommands',
    'optionChanged',
    'saveSettings',
    'caption',
    'repaint',
    'memoryLivePaint',
    'fontAssign',
    'timeCentiseconds',
  ]),
  hardware: methodsOf<HostHardware>()([
    'hardwareUpdate',
    'hardwareState',
    'hardwareTimer',
    'hardwareShow',
    'hardwareControls',
  ]),
  log: methodsOf<HostLog>()(['logWrite', 'logState', 'outputLogWrite']),
  files: methodsOf<HostFiles>()([
    'fileOpen',
    'fileRead',
    'fileWrite',
    'fileSeek',
    'fileClose',
    'fileRemove',
    'fileDialog',
  ]),
  text: methodsOf<HostIoText>()([
    'charOut',
    'textOut',
    'textOutCR',
    'clear',
    'getrc',
    'gotorc',
    'setFontProperties',
    'getCharAt',
    'scrollRect',
    'setWindowSize',
    'getWindowSize',
    'setupWindow',
    'ioShow',
    'ioBringToFront',
    'inputPrompt',
    'erasePrompt',
    'inputEcho',
    'inputBackspace',
    'doCRLF',
    'invalidate',
  ]),
  graphics: methodsOf<HostIoGraphics>()([
    'setLineColor',
    'setFillColor',
    'drawPixel',
    'getPixel',
    'line',
    'lineTo',
    'moveTo',
    'rectangle',
    'ellipse',
    'floodFill',
    'unfilledRectangle',
    'unfilledEllipse',
    'setDrawingMode',
    'setPenWidth',
    'formPaint',
    'drawText',
    'getXY',
  ]),
  sound: methodsOf<HostSound>()([
    'resetSounds',
    'playSound',
    'loadSound',
    'playSoundMem',
    'controlSound',
    'playSoundDX',
    'loadSoundDX',
    'playSoundMemDX',
    'controlSoundDX',
  ]),
  serial: methodsOf<HostSerial>()(['initComm', 'setCommParams', 'commRead', 'sendComm']),
  net: methodsOf<HostNet>()([
    'createNetClient',
    'createNetServer',
    'sendNet',
    'receiveNet',
    'sendPortNet',
    'receivePortNet',
    'closeNetConnection',
    'getLocalIP',
    'netCloseSockets',
  ]),
  printer: methodsOf<HostPrinter>()(['printerBeginDoc', 'printerEndDoc', 'printerMetric', 'printerTextOut']),
} as const satisfies { readonly [Part in keyof SimHostParts]: readonly (keyof SimHostParts[Part])[] };

/**
 * Binds the host methods of every part into one flat object. Each method is bound to its part, so a
 * part may be a class instance. Throws if a part lacks one of its host methods, or if two parts
 * define the same host method.
 */
export function createSimHost(parts: SimHostParts): SimHost {
  const host: Record<string, unknown> = {};
  for (const partName of Object.keys(HOST_PART_METHODS) as (keyof SimHostParts)[]) {
    const part = parts[partName] as unknown as Record<string, unknown> | undefined;
    if (!part) throw new TypeError(`createSimHost: the part "${partName}" is missing`);
    for (const name of HOST_PART_METHODS[partName] as readonly string[]) {
      const method = part[name];
      if (typeof method !== 'function') {
        throw new TypeError(`createSimHost: the part "${partName}" has no method ${name}()`);
      }
      if (Object.prototype.hasOwnProperty.call(host, name)) {
        throw new Error(`createSimHost: two parts define ${name}()`);
      }
      host[name] = (method as (...args: unknown[]) => unknown).bind(part);
    }
  }
  return host as unknown as SimHost;
}
