# easy68k-mac

An unofficial port of [EASy68K](http://www.easy68k.com/), the Motorola 68000 editor, assembler and simulator, so that it runs in a web browser and as a macOS app. The original runs only on Windows.

> **Status: work in progress. There is nothing to download or use yet.**
> This page will say so when that changes.

## What it is

EASy68K is widely used to teach 68000 assembly language. This project takes the original assembler and simulator code, compiles it to WebAssembly, and puts a new interface on top. Because the engine is the original's own code, programs are meant to assemble and run the same way they do in EASy68K v5.16.1 on Windows, quirks included.

Planned:

- a web version that needs no installation and works offline after the first visit
- a macOS app for Apple Silicon and Intel Macs
- the original's features: editor, assembler, simulator, text and graphics output, sound, hardware window, memory and stack views, breakpoints, logging

## What works today

- The simulator engine builds to WebAssembly and passes its own test suite.
- The assembler engine is being ported.
- The interface has not been started.

Nothing has been tested on a Mac yet.

## Credits

All credit for EASy68K goes to its authors:

- Editor by Tim Larson
- Assembler originally by Paul McKee, modified by Charles Kelly
- Simulator originally by Paul McKee, with the interface and later changes by Charles Kelly and Eric Nelson

The original source is at [ProfKelly/EASy68K](https://github.com/ProfKelly/EASy68K). This port is not affiliated with or endorsed by the EASy68K authors.

## Licence

GNU General Public License, version 2 or (at your option) any later version. See [LICENSE](LICENSE). EASy68K itself is distributed under the GNU General Public License.
