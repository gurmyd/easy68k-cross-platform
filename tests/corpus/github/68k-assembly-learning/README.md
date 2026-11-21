# 68k Assembly Learning

Small Motorola 68000 assembly language exercises and demos written for the Easy68K simulator.

## Contents

### `68k-assembly-tutorial`

Progressive examples covering:

- Hello World output
- Colour state tables
- The stack
- Cycling colours
- Keyboard input and keypress codes

### `68k-assembly-demos`

Standalone experiments that build on the tutorial concepts:

- Jump tables and state tables
- Reversing a word
- Ticking digits
- Bubble sort, including an AI-assisted variant
- Moire lines
- Keyboard input
- Bresenham triangle filling

### `68k-assembly-plot-digits`

A reusable digit plotting example split across source, macro, variable, and data files.

## Running the examples

1. Install the [Easy68K](http://www.easy68k.com/) environment.
2. Open an `.X68` source file in the editor.
3. Assemble the source and run it in the simulator.
4. Use the simulator display and keyboard controls as required by the example.

Most examples start at address `$1000` and use Easy68K monitor services through `TRAP #15`.

## Notes

- Source files use the `.X68` extension.
- Generated Easy68K files such as `.L68` and `.S68` are ignored by Git.
- The examples are intended for learning and experimentation rather than production use.

## License

This project is licensed under the MIT License. See [LICENCE](LICENCE) for the full text.