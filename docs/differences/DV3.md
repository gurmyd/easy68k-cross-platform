# Differences introduced by DV3 (macOS packaging and release)

Nothing in this package changes what a student's program can observe. The differences are in how
the macOS app reaches a user and how it starts the first time, compared with the Windows original,
which is a set of `.exe` files that Windows starts without any of this.

## 1. The first start of the downloaded Mac app (section 11)

The Mac app is signed **ad hoc**: it carries a valid signature that proves the files are unchanged
since the build, but no Apple Developer ID, and it is not notarised by Apple (ARCHITECTURE.md 7.6,
section 11). macOS marks every file downloaded with a web browser as "quarantined", and Gatekeeper
refuses to open a quarantined app that Apple has not notarised. This is the text the README and
every release note carry (`desktop/scripts/release.mjs` copies the part between the two marks into
the release notes):

<!-- first-start:begin -->
The Mac app is not notarised by Apple (the project has no paid Apple developer account), so macOS
blocks it the first time. This happens once; after that EASy68K opens like any other app. If you
cannot or do not want to do this (for example on a Mac managed by your school, where these settings
may be locked), use the web version instead: it does the same in Safari or Chrome and needs no
installation.

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

Not yet seen on a Mac by this package: the wording of the messages above is taken from Apple's
documentation and from reports of other ad-hoc signed apps, and the exact dialog on each macOS
version is an item of the manual test (ARCHITECTURE.md 6.8, `docs/MANUAL-TEST-MAC.md`, owner DOC1:
"First launch of the downloaded app: the Gatekeeper dialogs and the documented way through them").
Whoever runs it corrects this section, and the README, with what the screen says.

## 2. Two downloads instead of one

The original is one Windows installer. The port's Mac app comes as two builds, Apple silicon
(`arm64`) and Intel (`x64`), each as a `.dmg` and a `.zip` (1.1). There is no universal build: each
download carries only the code of its processor, including serialport's native module, which is
reduced to that processor (`desktop/scripts/after-pack.mjs`).

## 3. Version and the About box

The app's version (Finder's Get Info, `CFBundleShortVersionString`) is the port's own version from
the root `package.json` (7.5), not `5.16.1`. What a program or a file can observe keeps the
original's values (1.2).

## 4. No automatic updates

As 7.6 says, the app has no updater. A new version is downloaded from the releases page; the About
box's update check only says whether one exists (7.5).
