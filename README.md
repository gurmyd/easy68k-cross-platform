# easy68k-cross-platform

An unofficial port of [EASy68K](http://www.easy68k.com/), the Motorola 68000 editor, assembler and simulator, so that it runs outside Windows: in a web browser on any operating system, and as a macOS app. The original runs only on Windows.

> **Status: work in progress.**
> A preview of the web version is online at <https://gurmyd.github.io/easy68k-cross-platform/>. It is
> unfinished: expect defects, and do not rely on it for coursework yet. There is no macOS app to
> download yet. This page will say so when that changes.

## What it is

EASy68K is widely used to teach 68000 assembly language. This project takes the original assembler and simulator code, compiles it to WebAssembly, and puts a new interface on top. Because the engine is the original's own code, programs are meant to assemble and run the same way they do in EASy68K v5.16.1 on Windows, quirks included.

There are two ways to use it:

- **The web version**: open <https://gurmyd.github.io/easy68k-cross-platform/> in Chrome, Edge or Safari. Nothing is installed. Your programs are kept in the browser on your own computer; they are not uploaded anywhere. Firefox is not tested.
- **The macOS app**: the same program as a Mac application, for Apple Silicon and Intel Macs, with direct access to the files on your disk. It is built and tested automatically, but it has **not been released yet**, so there is nothing to download today.

## What works today

Everything below has automated tests. No person has tried it on a Mac yet: the list of things only a person can check is [docs/MANUAL-TEST-MAC.md](docs/MANUAL-TEST-MAC.md), and it has not been worked through.

- **The engines.** The assembler and the simulator core are the original's C++ code compiled to WebAssembly. They are checked against the official EASy68K v5.16.1 for Windows, run under Wine (`tests/oracle/wine`), by `npm run test:conformance` (`tests/conformance`):
  - **Assembler**: every test file with default options, and 30 chosen files with each of the eight assembler options switched alone. Of the 801 runs for which the official program gave a result (on 22 November 2026, with the course site's files, which are not in the repository), 654 produce byte-identical listing (`.L68`) and S-record (`.S68`) files; 143 are identical once the bytes of statements with an undefined symbol are masked (errors, where the original wrote whatever was in memory); 4 differ, each for a cause recorded in [docs/DIFFERENCES.md](docs/DIFFERENCES.md) (part T1). Six runs have no official result to compare with (the original crashes or stops at a message box, or, for two very large sources, was not run, because each such run needs more than an hour under Wine); they are listed there too.
  - **Simulator**: 184 of 187 self-reporting test programs write the official result byte for byte, and 31 of 32 execution logs (126,427 instructions) are identical. The 4 that differ are listed in docs/DIFFERENCES.md with their cause. 3 are accepted (the original showed leftover memory, or Wine draws differently from Windows). For the last one (a network error code) only the official program on real Windows can say whether Wine or the port is right, and nobody has run it there yet. What a program does with a file follows the C run-time inside the original's simulator, also where C leaves the outcome undefined (a read right after a write without a seek, for example); the two things that remain different there are in docs/DIFFERENCES.md, part SH6.
- **The three programs of the original**, as three modes of one window: the Editor/Assembler, the Simulator and EASyBIN, each with the original's menus.
- **Editor**: several files in tabs, syntax highlighting, Find and Replace, printing, the assembler's error messages next to the line, and the original's option dialogs.
- **Simulator**: run, step, trace, breakpoints (simple and advanced), the memory and stack views, the hardware window, logging, text and graphics output, keyboard and mouse input, sound, and files that a 68000 program reads and writes.
- **The original's help pages and its example programs** (Help > Examples...).
- **Additions beyond the original**, part of the application: panels that can be moved and docked (Window > Move Panel To...), a Files panel in which several files can be selected, deleted, moved and exported together, earlier versions of the files you save and a Trash for the files you delete (kept in the browser, never in your folders), and a viewer for PDF files and pictures. They change nothing a program does (except which files are left out first in a folder beyond the web version's limits, see below), no file the application writes, and nothing of the original's menus, commands and keys. The viewer and the safety net can be switched off in Options > Port Additions.... [docs/USER-GUIDE.md](docs/USER-GUIDE.md), section "Beyond the original", explains them. No person has tried the PDF viewer yet; a test machine saw it work in Chrome, Edge and the desktop app on Windows, and Safari has not been tried at all.
- **The web version** can be installed as an app from the browser and then works offline.
- **Test runs**: every change is tested automatically on GitHub's Windows, macOS and Linux machines, in the engines of Chrome (Chromium) and Safari (WebKit) as the test tool Playwright ships them (not in Safari itself, and not in Firefox). Every official example is opened, assembled, executed and run in the real application in both engines.
- **The macOS app** is built and signed (ad hoc, without an Apple developer account) by the release workflow (`.github/workflows/release.yml`) for Apple Silicon and Intel, and the built app passes its automatic checks on GitHub's Mac machines of both kinds. No release has been published from it.

Everything the port does differently from the original, and why, is in [docs/DIFFERENCES.md](docs/DIFFERENCES.md); its last part lists the limitations known today (for example, a program in the web version can open at most 2,000 files of its folder and the folders below it; the files of a `.git` folder are counted last, so a Git repository no longer pushes the program's own files out, but the limit itself remains). The automatic accessibility audit has no open finding today: [docs/integration/rc.md](docs/integration/rc.md) records the six it found and how each was repaired; no person has tried the port with a screen reader yet. The findings of the integration gate after the second wave are in [docs/integration/wave2.md](docs/integration/wave2.md).

## Using it

[docs/USER-GUIDE.md](docs/USER-GUIDE.md) explains how to write, assemble and run a program, where your files are kept, the keyboard on a Mac, and what to do when something does not work.

## Opening the Mac app for the first time

There is no Mac app to download yet. When a release is published, this is what you will need to know, because macOS will not open the app straight away the first time. The warning macOS shows does not mean that something is wrong with your Mac or with the app: Apple shows it for every app whose maker has not paid for an Apple developer account and sent the app to Apple for checking ("notarisation"). This project has no such account. The same steps are in the notes of every release.

<!-- first-start:begin -->
The Mac app is not notarised by Apple (the project has no paid Apple developer account), so macOS
blocks it the first time. This happens once; after that EASy68K opens like any other app. If you
cannot or do not want to do this (for example on a Mac managed by your school, where these settings
may be locked), use the web version instead: it does the same in Safari or Chrome and needs no
installation.

The Mac app needs macOS 13 (Ventura) or later.

**Install.** Download the `.dmg` for your Mac (`arm64` for Apple silicon, M1 and later; `x64` for
Intel; Apple menu > About This Mac tells you which), open it and drag **EASy68K** into
**Applications**. (Or download the `.zip`, which macOS unpacks into `EASy68K.app`, and move that
into Applications.)

**What you will see.** When you open EASy68K for the first time, macOS shows a message instead of
starting it. On macOS 15 (Sequoia) and later it reads "“EASy68K” Not Opened. Apple could not verify
“EASy68K” is free of malware that may harm your Mac or compromise your privacy.", with the buttons
**Done** and **Move to Trash**; older versions say "“EASy68K” cannot be opened because the developer
cannot be verified." Some versions instead say that "“EASy68K” is damaged and can't be opened". The
app is not damaged: this is how macOS words the same block for an app that is not notarised. Click
**Done** (or **Cancel**), never **Move to Trash**.

**Way 1: System Settings** (for the "Not Opened" or "developer cannot be verified" message)

1. Open **System Settings** (Apple menu > System Settings) and choose **Privacy & Security** in the
   sidebar.
2. Scroll down to the **Security** section. It shows "“EASy68K” was blocked to protect your Mac."
   (The line appears for about an hour after you tried to open the app; if it is gone, try to open
   EASy68K once more.)
3. Click **Open Anyway** and confirm with your password or Touch ID.
4. Open EASy68K again. macOS asks a last time; click **Open Anyway** (or **Open**).

On macOS 14 (Sonoma) and earlier you can instead Control-click (or right-click) EASy68K in
Applications, choose **Open** from the menu and then click **Open** in the message.

**Way 2: Terminal** (works for every message, including "is damaged")

1. Open **Terminal** (Applications > Utilities > Terminal).
2. Paste this line and press Return. It removes the quarantine mark from the app, and asks for
   nothing:

   ```
   xattr -dr com.apple.quarantine /Applications/EASy68K.app
   ```

3. Open EASy68K as usual.

If you put the app somewhere else than Applications, use its path in the command instead (you can
type `xattr -dr com.apple.quarantine ` and then drag the app onto the Terminal window).
<!-- first-start:end -->

What has been checked so far: on GitHub's Mac machines, a downloaded copy of the app is refused by macOS for exactly this reason (it is not notarised; its signature is intact). Nobody has yet seen the message on a real Mac, so its exact wording above comes from Apple's documentation and may differ slightly on your Mac. If it does, please tell us (see [docs/MANUAL-TEST-MAC.md](docs/MANUAL-TEST-MAC.md)).

## For contributors: build and test

You need:

- **Git**.
- **Node.js 24** (it comes with npm 11). Check with `node --version`.
- **Python 3** on macOS and Linux (Emscripten's installer needs it; on a Mac it comes with the Xcode command line tools, which `git` asks you to install the first time). Windows needs nothing extra.
- About 4 GB of free disk space and a network connection. On a fast computer everything below takes
  about twenty minutes, most of it the browser tests.

The commands are the same on Windows (in PowerShell or Git Bash), macOS and Linux. Run them one after the other in a terminal:

```sh
git clone https://github.com/gurmyd/easy68k-cross-platform.git
cd easy68k-cross-platform
npm ci
npm run setup:emsdk
npm run build:engines
npm test
```

What each one does:

1. `git clone` and `cd` fetch the source and go into its folder.
2. `npm ci` installs the exact versions of every tool the project uses, as listed in `package-lock.json`. It also downloads Electron, which the desktop app needs.
3. `npm run setup:emsdk` installs Emscripten 7.0.0, the C++ compiler that turns the original's code into WebAssembly, into the folder `.toolchain/emsdk` inside the project. Nothing outside the project is changed. This takes a few minutes the first time.
4. `npm run build:engines` compiles the two engines (assembler and simulator) into `engine/dist/`. Every other step needs them.
5. `npm test` runs the unit tests of the application. The last lines say how many passed.

More checks, the same that run on every change:

```sh
npm run typecheck
npm run lint
npm run test:conformance
```

`npm run test:conformance` compares the engines with the results of the official EASy68K that are stored in the repository.

To try the application itself, run `npm run dev` and open the address it prints (for example `http://localhost:5173/`) in your browser. Stop it with Ctrl+C.

The tests that drive a real browser need Playwright's Chromium and WebKit once:

```sh
npx playwright install --with-deps chromium webkit
npm run build
npm run test:e2e
```

On Linux, `--with-deps` installs the libraries the browsers need, and asks for your password (it uses `sudo`). There are also more than thirty single checks, one per part of the application, such as `npm run check:shell`; `package.json` lists them.

[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) explains how the project is organised, how to change it, and the rules a change must follow. The design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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
