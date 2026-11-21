// 68000 programs for the Output feature's tests (unit tests under Node and check-output.mjs in
// the browsers). Each is given as source lines for the real assembler; the constants next to it
// say where the program keeps what a test reads back from the engine's memory.
//
// Every load fills memory with $FF, so the programs carry their variables as zeros (DC, DCB).

/** Where the programs keep their variables. */
export const DATA = 0x3000;

/* ------------------------------------------------------------------ keys: TRAP #15 task 19 */

/** Addresses of the key-watch program's variables. */
export const KEYS = {
  /** Long: the last result of task 19 with D1.L = 0, `(key-up code << 16) + key-down code`. */
  last: DATA,
  /** Long, written by the TEST: up to four virtual keys whose state the program asks for. */
  watch: DATA + 4,
  /** Long: the last answer for `watch`, $FF per byte whose key is down. */
  state: DATA + 8,
  /** Long: every answer for `watch` OR-ed together - a key seen down at least once. */
  held: DATA + 12,
  /** Long: how often the main loop has run. */
  rounds: DATA + 16,
  /** Long: how many key-down interrupts were served. */
  interrupts: DATA + 20,
  /** Byte, written by the TEST: non-zero makes the program ask for windowed mode once (task 33). */
  askWindowed: DATA + 24,
  /** 256 bytes: [vk] = 1 once task 19 reported `vk` as the last key that went down. */
  downs: DATA + 0x100,
  /** 256 bytes: [vk] = 1 once task 19 reported `vk` as the last key that went up. */
  ups: DATA + 0x200,
  /** 256 bytes: [vk] = 1 once the key-down interrupt handler saw `vk` as the last key down. */
  interruptDowns: DATA + 0x300,
} as const;

export interface KeyWatchOptions {
  /** Starts with TRAP #15 task 24, D1.L = 1: the simulator's key commands are switched off. */
  keyCommandsOff?: boolean;
  /** Enables exceptions and a key-down interrupt on level 1 (task 62). */
  keyDownInterrupt?: boolean;
  /** Starts with TRAP #15 task 33, D1.L = 2: the program asks for full screen. */
  askFullScreen?: boolean;
  /** Before it asks for full screen the program waits this long with task 23 (units of 1/100 s),
   *  so that a test can let the user gesture that started the program run out. */
  askFullScreenAfter?: number;
}

/**
 * A program that polls task 19 for ever. With D1.L = 0 it records the last key-down and key-up
 * codes; with the four codes the test put into `watch` it records which of those keys are down.
 */
export function keyWatchProgram(options: KeyWatchOptions = {}): string[] {
  return [
    '        ORG     $1000',
    'START:',
    ...(options.keyCommandsOff ? ['        MOVEQ   #1,D1', '        MOVEQ   #24,D0', '        TRAP    #15'] : []),
    ...(options.keyDownInterrupt
      ? [
          '        MOVE.L  #KEYIRQ,$64         ; level 1 autovector',
          '        MOVEQ   #5,D1               ; task 32: enable exceptions',
          '        MOVEQ   #32,D0',
          '        TRAP    #15',
          '        MOVE.W  #$0101,D1           ; task 62: key-down interrupt, level 1',
          '        MOVEQ   #62,D0',
          '        TRAP    #15',
        ]
      : []),
    ...(options.askFullScreen && options.askFullScreenAfter
      ? [`        MOVE.L  #${options.askFullScreenAfter},D1`, '        MOVEQ   #23,D0', '        TRAP    #15']
      : []),
    ...(options.askFullScreen ? ['        MOVEQ   #2,D1', '        MOVEQ   #33,D0', '        TRAP    #15'] : []),
    'LOOP:   MOVEQ   #0,D1',
    '        MOVEQ   #19,D0',
    '        TRAP    #15                 ; D1 = (key-up code << 16) + key-down code',
    '        MOVE.L  D1,LAST',
    '        MOVEQ   #0,D2',
    '        MOVE.B  D1,D2',
    '        LEA     DOWNS,A0',
    '        MOVE.B  #1,0(A0,D2.W)',
    '        SWAP    D1',
    '        MOVE.B  D1,D2',
    '        LEA     UPS,A0',
    '        MOVE.B  #1,0(A0,D2.W)',
    '        MOVE.L  WATCH,D1',
    '        BEQ.S   COUNT',
    '        MOVEQ   #19,D0',
    '        TRAP    #15                 ; $FF for each of the four keys that is down',
    '        MOVE.L  D1,STATE',
    '        OR.L    D1,HELD',
    'COUNT:  ADDQ.L  #1,ROUNDS',
    '        TST.B   ASKWIN',
    '        BEQ     LOOP',
    '        CLR.B   ASKWIN',
    '        MOVEQ   #1,D1               ; task 33: windowed mode',
    '        MOVEQ   #33,D0',
    '        TRAP    #15',
    '        BRA     LOOP',
    'KEYIRQ: MOVEM.L D0-D2/A0,-(SP)',
    '        ADDQ.L  #1,IRQS',
    '        MOVEQ   #0,D1',
    '        MOVEQ   #19,D0',
    '        TRAP    #15',
    '        MOVEQ   #0,D2',
    '        MOVE.B  D1,D2',
    '        LEA     IRQDOWNS,A0',
    '        MOVE.B  #1,0(A0,D2.W)',
    '        MOVEM.L (SP)+,D0-D2/A0',
    '        RTE',
    `        ORG     $${DATA.toString(16)}`,
    'LAST    DC.L    0',
    'WATCH   DC.L    0',
    'STATE   DC.L    0',
    'HELD    DC.L    0',
    'ROUNDS  DC.L    0',
    'IRQS    DC.L    0',
    'ASKWIN  DC.B    0',
    `        ORG     $${(DATA + 0x100).toString(16)}`,
    'DOWNS   DCB.B   256,0',
    'UPS     DCB.B   256,0',
    'IRQDOWNS DCB.B  256,0',
    '        END     START',
  ];
}

/* ------------------------------------------------------------------ line input: TRAP #15 task 2 */

export const LINES = {
  /** Long: how many lines have been read. */
  count: DATA,
  /** Eight longs: the length task 2 returned for each line (D1.L). */
  lengths: DATA + 4,
  /** Eight buffers of 128 bytes: the lines, each with its NUL. */
  text: DATA + 0x100,
  size: 128,
} as const;

/** A program that reads lines with task 2, one after the other, into buffers of 128 bytes. */
export function lineInputProgram(): string[] {
  return [
    '        ORG     $1000',
    'START:  LEA     TEXT,A2',
    '        LEA     LENGTHS,A3',
    'NEXT:   MOVEA.L A2,A1',
    '        MOVEQ   #2,D0',
    '        TRAP    #15                 ; read a line into (A1), D1.L = its length',
    '        MOVE.L  D1,(A3)+',
    '        ADDQ.L  #1,COUNT',
    `        ADDA.L  #${LINES.size},A2`,
    '        BRA     NEXT',
    `        ORG     $${DATA.toString(16)}`,
    'COUNT   DC.L    0',
    'LENGTHS DCB.L   8,0',
    `        ORG     $${(DATA + 0x100).toString(16)}`,
    `TEXT    DCB.B   ${8 * LINES.size},0`,
    '        END     START',
  ];
}

/* ------------------------------------------------------------------ characters: TRAP #15 task 5 */

export const CHARS = {
  /** Long: how many characters have been read. */
  count: DATA,
  /** The characters, in the order task 5 returned them. */
  text: DATA + 0x100,
} as const;

/** A program that reads single characters with task 5 for ever and stores each one. */
export function charLoopProgram(): string[] {
  return [
    '        ORG     $1000',
    'START:  LEA     TEXT,A2',
    'NEXT:   MOVEQ   #5,D0',
    '        TRAP    #15                 ; read one character into D1.B',
    '        MOVE.B  D1,(A2)+',
    '        ADDQ.L  #1,COUNT',
    '        BRA     NEXT',
    `        ORG     $${DATA.toString(16)}`,
    'COUNT   DC.L    0',
    `        ORG     $${(DATA + 0x100).toString(16)}`,
    'TEXT    DCB.B   256,0',
    '        END     START',
  ];
}

/* ------------------------------------------------------------------ mouse: TRAP #15 task 61 */

export const MOUSE = {
  /** Longs: D0 (buttons and modifier keys) and D1 (`(y << 16) | x`) of task 61 for the current
   *  state, the button-up snapshot and the button-down snapshot. */
  current: DATA,
  currentPosition: DATA + 4,
  up: DATA + 8,
  upPosition: DATA + 12,
  down: DATA + 16,
  downPosition: DATA + 20,
  /** Long: how often the loop has run. */
  rounds: DATA + 24,
} as const;

/** A program that reads the three mouse snapshots of task 61 for ever. */
export function mouseWatchProgram(): string[] {
  const read = (selector: number, flags: string, position: string) => [
    `        MOVEQ   #${selector},D1`,
    '        MOVEQ   #61,D0',
    '        TRAP    #15',
    `        MOVE.L  D0,${flags}`,
    `        MOVE.L  D1,${position}`,
  ];
  return [
    '        ORG     $1000',
    'START:',
    ...read(0, 'CUR', 'CURPOS'),
    ...read(1, 'UP', 'UPPOS'),
    ...read(2, 'DOWN', 'DOWNPOS'),
    '        ADDQ.L  #1,ROUNDS',
    '        BRA     START',
    `        ORG     $${DATA.toString(16)}`,
    'CUR     DC.L    0',
    'CURPOS  DC.L    0',
    'UP      DC.L    0',
    'UPPOS   DC.L    0',
    'DOWN    DC.L    0',
    'DOWNPOS DC.L    0',
    'ROUNDS  DC.L    0',
    '        END     START',
  ];
}

/* ------------------------------------------------------------------ a picture */

export const PICTURE = {
  /** Byte, written by the TEST: non-zero makes the program set the size 800x600 (task 33) and draw again. */
  resize: DATA,
  /** Long: how often the picture has been drawn. */
  drawn: DATA + 4,
  /** The red pixel the program draws with task 82. */
  pixel: { x: 3, y: 2, color: 0x0000ff },
  /** The green rectangle it fills with task 87 (right and bottom exclusive in the test double). */
  box: { left: 100, top: 100, right: 200, bottom: 150, color: 0x00ff00 },
  text: 'HELLO',
} as const;

/**
 * A program that writes `HELLO`, draws a red pixel and a green box, and then waits. When the test
 * sets `resize` it switches the surface to 800x600, which blacks it, and draws the picture again.
 */
export function pictureProgram(): string[] {
  const { pixel, box } = PICTURE;
  return [
    '        ORG     $1000',
    'START:  LEA     HELLO,A1',
    '        MOVEQ   #13,D0              ; display the text, then CR LF',
    '        TRAP    #15',
    `        MOVE.L  #$${pixel.color.toString(16)},D1`,
    '        MOVEQ   #80,D0              ; pen colour',
    '        TRAP    #15',
    `        MOVEQ   #${pixel.x},D1`,
    `        MOVEQ   #${pixel.y},D2`,
    '        MOVEQ   #82,D0              ; draw a pixel',
    '        TRAP    #15',
    `        MOVE.L  #$${box.color.toString(16)},D1`,
    '        MOVEQ   #81,D0              ; fill colour',
    '        TRAP    #15',
    `        MOVE.W  #${box.left},D1`,
    `        MOVE.W  #${box.top},D2`,
    `        MOVE.W  #${box.right},D3`,
    `        MOVE.W  #${box.bottom},D4`,
    '        MOVEQ   #87,D0              ; filled rectangle',
    '        TRAP    #15',
    '        ADDQ.L  #1,DRAWN',
    'WAIT:   TST.B   RESIZE',
    '        BEQ     WAIT',
    '        CLR.B   RESIZE',
    '        MOVE.L  #$03200258,D1       ; 800 x 600',
    '        MOVEQ   #33,D0',
    '        TRAP    #15',
    '        BRA     START',
    `        ORG     $${DATA.toString(16)}`,
    'RESIZE  DC.B    0',
    '        DS.B    3',
    'DRAWN   DC.L    0',
    `HELLO   DC.B    '${PICTURE.text}',0`,
    '        END     START',
  ];
}
