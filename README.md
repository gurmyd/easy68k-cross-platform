# easy68k-cross-platform

An unofficial port of [EASy68K](http://www.easy68k.com/), the Motorola 68000 editor, assembler and simulator, so that it runs outside Windows: in a web browser on any operating system, and as a macOS app. The original runs only on Windows.

> **Status: work in progress.**
> A preview of the web version is online at <https://gurmyd.github.io/easy68k-cross-platform/>. It is
> unfinished: expect defects, and do not rely on it for coursework yet. There is no macOS app to
> download yet. This page will say so when that changes.

## What it is

EASy68K is widely used to teach 68000 assembly language. This project takes the original assembler and simulator code, compiles it to WebAssembly, and puts a new interface on top. Because the engine is the original's own code, programs are meant to assemble and run the same way they do in EASy68K v5.16.1 on Windows, quirks included.

Planned:

- a web version that needs no installation and works offline after the first visit, on Windows, macOS, Linux and ChromeOS (tested with the engines of Chrome and Safari; Firefox is not tested yet)
- a macOS app for Apple Silicon and Intel Macs
- the original's features: editor, assembler, simulator, text and graphics output, sound, hardware window, memory and stack views, breakpoints, logging

## What works today

- The assembler and the simulator core are the original's code compiled to WebAssembly. Their test suites pass on macOS, Linux and Windows on every push.
- Checked against the official EASy68K v5.16.1 for Windows, run under Wine: all 420 error-free test programs assemble to byte-identical listing and S-record files, and 9 of 9 execution logs match. The comparison is in `tests/oracle/wine` and `tests/conformance`.
- In the preview: the editor, Assemble, and the simulator with text and graphics output, keyboard input, the hardware window, memory and stack views, breakpoints, logging, sound and file access, plus the original's help pages and examples.
- These parts have automated tests that run in Chrome's and Safari's engines on GitHub's macOS, Linux and Windows machines. They have not been through the last rounds of checking yet. Known defects are listed in `docs/integration/wave1.md`.
- The macOS app exists as a development build that is tested on GitHub's macOS machines. The installer is not built yet.

No person has tried it on a Mac yet.

## The name

The repository was called `easy68k-mac` until November 2026. Its old address redirects here; the name still appears inside the code as the label of this port's changes to the original sources.

## Credits

All credit for EASy68K goes to its authors:

- Editor by Tim Larson
- Assembler originally by Paul McKee, modified by Charles Kelly
- Simulator originally by Paul McKee, with the interface and later changes by Charles Kelly and Eric Nelson

The original source is at [ProfKelly/EASy68K](https://github.com/ProfKelly/EASy68K). This port is not affiliated with or endorsed by the EASy68K authors.

## Licence

GNU General Public License, version 2 or (at your option) any later version. See [LICENSE](LICENSE). EASy68K itself is distributed under the GNU General Public License.
