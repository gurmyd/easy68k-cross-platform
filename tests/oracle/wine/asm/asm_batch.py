#!/usr/bin/env python3
"""Assemble .X68 sources with the OFFICIAL EDIT68K.exe under Wine.

Runs inside the easy68k-oracle-wine container (see ../README.md).

For each source: write settings.dat, start EDIT68K.exe with the file, press F9,
dismiss "Assembler Status" with Alt+C (its Close button - never Enter, which
would press Execute and start the simulator), close with Alt+F4, collect
<name>.L68 / <name>.S68, and capture the exact text the editor handed to the
assembler (EASy68Ks.tmp, see below).

Windows: besides the editor and its "Assembler Status" dialog only the editor's
help-viewer message boxes are expected (HELP_BOXES below); they are dismissed and
recorded. Any other window - a save prompt on exit included, since the buffer is
never modified - fails the run (ARCHITECTURE.md 6.2.2): it is recorded with a
screenshot, the editor is killed, and the run's status is "fail". The .L68 and
.S68 the editor wrote before that are still collected.

Capturing EASy68Ks.tmp: the editor writes the buffer to EASy68Ks.tmp beside the
source, assembles, and deletes it (mainS.cpp:371-375). Before starting we create
an empty EASy68Ks.tmp and a hard link to it elsewhere. Wine opens the existing
file with CREATE_ALWAYS (truncate, same inode), so after DeleteFile removes the
name our link still holds exactly the bytes the assembler read.

Two ways to say what to assemble:

  asm_batch.py --corpus /work/corpus --jobs jobs.jsonl --out /mnt/out
               [--shard 0/1] [--timeout 300]
    jobs.jsonl has one JSON object per line (written by regenerate.mjs):
      {"id": ..., "source": <path below --corpus>, "options": <label>,
       "settings": <settings.dat to use, path below the jobs file's folder>,
       "out": <output folder below --out>}
    Writes <out>/<job out>/{name.L68,name.S68,name.received.txt} and
    <out>/manifest-shard<k>.jsonl (one JSON object per job).

  asm_batch.py --corpus /work/corpus --list files.txt --options default|expand
               --out /mnt/out/asm [--shard 0/1] [--timeout 300]
    files.txt has one corpus-relative path per line; "default" is the shipped
    settings.dat, "expand" the same with the three expansion options on.
    Writes <out>/<options>/<rel>/{name.L68,name.S68,name.received.txt} and
    <out>/<options>/manifest-shard<k>.jsonl (one JSON object per source).

  asm_batch.py --self-test
    Checks the window rule (window_verdict) without a display; exit status 1 on a failure.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time

# In the image the scripts are in one folder; in the repository xwin.py is in ../common.
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [_HERE, os.path.join(os.path.dirname(_HERE), "common")]
import xwin  # noqa: E402
import richedit_check  # noqa: E402

EXE_DIR = "/opt/easy68k"
MAIN_RX = r"^EASy68K Editor/Assembler"
STATUS_RX = r"^Assembler Status"
EXPAND_LINES = (b"$macros expanded", b"$structured expand", b"$constants expand")


def make_settings(shipped: bytes, options: str) -> bytes:
    if options == "default":
        return shipped
    if options != "expand":
        raise SystemExit("unknown options " + options)
    out = []
    for line in shipped.split(b"\r\n"):
        if line[1:] in EXPAND_LINES:
            line = b"1" + line[1:]
        out.append(line)
    return b"\r\n".join(out)


def find_case(d, stem, ext):
    """Return the file in d whose name is stem+ext, any case of the extension."""
    for n in os.listdir(d):
        base, e = os.path.splitext(n)
        if base == stem and e.lower() == ext.lower():
            return os.path.join(d, n)
    return None


# The caption of every ShowMessage box of the editor: Application->Title (EDIT68K.cpp:24).
APP_TITLE = "EASy68K"
# The editor's help-viewer message boxes (mainS.cpp), all ShowMessage boxes, so all of them
# carry APP_TITLE and nothing else that xdotool can read:
#   at start-up, from the main form's constructor, before the editor window exists:
#     "Help file not found" (:149), "Error loading Html Help" (:123),
#     "HTML Help was not detected on this computer. ..." (:154);
#   at exit, from FormClose: "Html Help may not have closed correctly" (:807).
# The value is how many of them the source can show in that phase of a run.
HELP_BOXES = {"start": 3, "exit": 1}
# The phases of a run, as the error text of an unexpected window names them.
PHASE_TEXT = {
    "start": "before the editor window appeared",
    "assemble": "while the editor assembled",
    "status": "above the Assembler Status dialog",
    "exit": "after Alt+F4",
}


class UnexpectedWindow(RuntimeError):
    """A window appeared that a run of the editor must not show."""


def window_verdict(title, phase, help_boxes_seen):
    """What a window is that is neither the editor nor its status dialog.

    phase: "start" (before the editor window appeared), "assemble" (F9 was pressed),
    "status" (the status dialog is up), "exit" (after Alt+F4).
    help_boxes_seen: how many help-viewer boxes this phase has dismissed so far.

    Returns "help" for a help-viewer message box (it is dismissed and the run goes on)
    and "unexpected" for everything else (the run fails).
    """
    if title == APP_TITLE and help_boxes_seen < HELP_BOXES.get(phase, 0):
        return "help"
    return "unexpected"


def self_test():
    """The window rule, checked without a display (`asm_batch.py --self-test`)."""
    cases = [
        # help-viewer boxes: only where the source shows them, and only as many
        ("EASy68K", "start", 0, "help"),
        ("EASy68K", "start", 2, "help"),
        ("EASy68K", "start", 3, "unexpected"),
        ("EASy68K", "exit", 0, "help"),
        ("EASy68K", "exit", 1, "unexpected"),
        # the access-violation box of a 4000-character line (official-oracle 3.4)
        ("EASy68K", "status", 0, "unexpected"),
        ("EASy68K", "assemble", 0, "unexpected"),
        # "File modified, save?" on exit, "Error in LoadFile()" (textS.cpp:202), anything else
        ("Confirm", "exit", 0, "unexpected"),
        ("Information", "start", 0, "unexpected"),
        ("Error", "assemble", 0, "unexpected"),
        ("EASy68K Help", "start", 0, "unexpected"),
        ("", "start", 0, "unexpected"),
    ]
    failed = [c for c in cases if window_verdict(c[0], c[1], c[2]) != c[3]]
    for title, phase, seen, want in failed:
        print("self-test FAILED: window_verdict(%r, %r, %d) is not %r" % (title, phase, seen, want))
    print("asm_batch.py self-test: %d of %d cases passed" % (len(cases) - len(failed), len(cases)))
    return 1 if failed else 0


def check_windows(rec, shots_dir, tag, phase, expected):
    """Look at every visible window for which `expected(window)` is false.

    A help-viewer message box is dismissed with Enter and recorded in rec["help_boxes"].
    Any other window is recorded in rec["stray_windows"] with a screenshot and raises
    UnexpectedWindow. Returns the titles of the boxes dismissed (empty: nothing was there).
    """
    dismissed = []
    for win in xwin.real_windows():
        wid, title = win[0], win[1]
        if expected(win):
            continue
        seen = sum(1 for box in rec["help_boxes"] if box["when"] == phase)
        shot = os.path.join(shots_dir, "%s-%d.png" % (tag, len(rec["stray_windows"]) + len(rec["help_boxes"])))
        xwin.screenshot(shot)
        if window_verdict(title, phase, seen) == "help":
            rec["help_boxes"].append({"title": title, "when": phase, "screenshot": shot})
            xwin.key(wid, "Return")     # a ShowMessage box: OK
            xwin.wait_gone(wid, 3)
            dismissed.append(title)
            continue
        rec["stray_windows"].append({"title": title, "when": phase, "screenshot": shot})
        raise UnexpectedWindow('unexpected window "%s" %s' % (title, PHASE_TEXT[phase]))
    return dismissed


def wine_tail(n=3):
    try:
        lines = open("/tmp/edit68k-wine.log", "rb").read().decode("latin-1").splitlines()
        return " | ".join(l for l in lines if ":err:" in l)[-400:] or "(no err lines)"
    except OSError:
        return ""


def assemble_one(src, rel, settings, out_dir, shots_dir, timeout):
    t0 = time.monotonic()
    d = os.path.dirname(src)
    name = os.path.basename(src)
    stem = os.path.splitext(name)[0]
    rec = {"source": rel, "status": "fail", "error": None, "stray_windows": [], "help_boxes": [],
           "outputs": [], "errors": None, "warnings": None}
    os.makedirs(out_dir, exist_ok=True)

    # clean previous outputs and temp files
    for ext in (".L68", ".S68"):
        f = find_case(d, stem, ext)
        if f:
            os.remove(f)
    for t in ("EASy68Ks.tmp", "EASy68Km.tmp"):
        p = os.path.join(d, t)
        if os.path.exists(p):
            os.remove(p)
    with open(os.path.join(EXE_DIR, "settings.dat"), "wb") as f:
        f.write(settings)

    # hard-link trap for the buffer the assembler receives
    cap = "/tmp/capture.tmp"
    if os.path.exists(cap):
        os.remove(cap)
    open(os.path.join(d, "EASy68Ks.tmp"), "wb").close()
    os.link(os.path.join(d, "EASy68Ks.tmp"), cap)

    log = open("/tmp/edit68k-wine.log", "wb")
    env = dict(os.environ, WINEDEBUG="err+all")
    proc = subprocess.Popen(["wine", os.path.join(EXE_DIR, "EDIT68K.exe"), xwin.winpath(src)],
                            cwd=d, stdout=log, stderr=log, start_new_session=True, env=env)

    def editor_or_status(win):
        return bool(re.search(MAIN_RX, win[1]) or re.search(STATUS_RX, win[1]))

    phase = "start"
    try:
        deadline = t0 + timeout
        tag = rel.replace("/", "_")

        def watch():
            # stop waiting early if the editor died (e.g. a crash); a help-viewer box is
            # dismissed here, any other window raises UnexpectedWindow
            if proc.poll() is not None:
                return "exited"
            return check_windows(rec, shots_dir, tag, phase, editor_or_status) or None

        def wait(rx, secs):
            while True:
                w = xwin.wait_for(rx, max(0.5, min(secs, deadline - time.monotonic())), also=watch)
                if w and w[0] == "abort":
                    if w[1] == "exited":
                        raise RuntimeError("EDIT68K exited unexpectedly (crash?) exit code %s; wine: %s"
                                           % (proc.returncode, wine_tail()))
                    continue
                return w

        # large sources take a long time to load into the RichEdit control
        main = wait(MAIN_RX, timeout)
        if not main:
            raise RuntimeError("editor main window did not appear within %ss" % timeout)
        rec["t_main"] = round(time.monotonic() - t0, 2)

        phase = "assemble"
        status = None
        for attempt in range(4):
            xwin.key(main[0], "F9")
            status = wait(STATUS_RX, 3)
            if status:
                break
            if os.path.getsize(cap) > 0 or find_case(d, stem, ".L68"):
                # assembly has started (buffer saved / listing created): wait for it
                status = wait(STATUS_RX, deadline - time.monotonic())
                break
            if time.monotonic() > deadline:
                break
        if not status:
            raise RuntimeError("Assembler Status dialog did not appear within %ss (F9 pressed %d times)"
                               % (timeout, attempt + 1))
        rec["status_title"] = status[1]
        rec["f9_presses"] = attempt + 1
        rec["t_status"] = round(time.monotonic() - t0, 2)
        if not status[1].endswith(" - " + name):
            rec["warning"] = "status dialog names another file: " + status[1]

        phase = "status"
        closed = False
        for _ in range(3):
            # a modal box above the status dialog (e.g. the VCL "Access violation" box that
            # a 4000-character line raises, official-oracle 3.4) fails the run
            check_windows(rec, shots_dir, tag, phase, lambda win: win[0] in (status[0], main[0]))
            xwin.key(status[0], "alt+c")
            if xwin.wait_gone(status[0], 4):
                closed = True
                break
        if not closed:
            raise RuntimeError("Assembler Status dialog did not close on Alt+C")

        rec["t_closed"] = round(time.monotonic() - t0, 2)
        # exit the editor; a "Confirm" save prompt would mean that the buffer was modified
        phase = "exit"
        main = xwin.find(MAIN_RX) or main
        xwin.key(main[0], "alt+F4")
        end = time.monotonic() + 15
        while proc.poll() is None and time.monotonic() < end:
            check_windows(rec, shots_dir, tag, phase, lambda win: bool(re.search(MAIN_RX, win[1])))
            time.sleep(0.1)
        if proc.poll() is None:
            rec["exit"] = "killed (did not exit after Alt+F4)"
        else:
            rec["exit"] = "clean"
        rec["status"] = "ok"
    except Exception as e:  # noqa: BLE001
        rec["error"] = str(e)
        rec["windows_at_failure"] = [w[1] for w in xwin.real_windows()]
        xwin.screenshot(os.path.join(shots_dir, rel.replace("/", "_") + "-fail.png"))
    finally:
        if proc.poll() is None:
            if not xwin.kill_exe("EDIT68K.exe"):
                xwin.wine_reset()
            try:
                proc.wait(5)
            except subprocess.TimeoutExpired:
                xwin.wine_reset()
        log.close()

    # collect outputs
    for ext in (".L68", ".S68"):
        f = find_case(d, stem, ext)
        if f:
            shutil.copy2(f, os.path.join(out_dir, os.path.basename(f)))
            rec["outputs"].append(os.path.basename(f))
    for t in ("EASy68Ks.tmp", "EASy68Km.tmp"):
        if os.path.exists(os.path.join(d, t)):
            rec.setdefault("leftover_temp", []).append(t)
            os.remove(os.path.join(d, t))
    got = open(cap, "rb").read() if os.path.exists(cap) else b""
    with open(os.path.join(out_dir, stem + ".received.txt"), "wb") as f:
        f.write(got)
    srcb = open(src, "rb").read()
    rec["source_features"] = richedit_check.source_features(srcb)
    rec["received_bytes"] = len(got)
    if rec["status"] == "ok":
        rec["richedit"] = richedit_check.classify(srcb, got)
    lst = find_case(d, stem, ".L68")
    if lst:
        txt = open(lst, "rb").read().decode("latin-1")
        m = re.search(r"^(\d+) errors? detected", txt, re.M)
        rec["errors"] = int(m.group(1)) if m else (0 if "No errors detected" in txt else None)
        m = re.search(r"^(\d+) warnings? generated", txt, re.M)
        rec["warnings"] = int(m.group(1)) if m else (0 if "No warnings generated" in txt else None)
    if rec["status"] == "ok" and not rec["outputs"]:
        rec["status"] = "fail"
        rec["error"] = "no .L68/.S68 produced"
    rec["reliable"] = rec["status"] == "ok" and rec.get("richedit", {}).get("identical", False)
    rec["seconds"] = round(time.monotonic() - t0, 2)
    return rec


def run_jobs(a, k, n):
    """--jobs: every job names its own settings.dat and output folder."""
    job_dir = os.path.dirname(os.path.abspath(a.jobs))
    jobs = [json.loads(l) for l in open(a.jobs, encoding="utf-8") if l.strip()]
    jobs = [j for i, j in enumerate(jobs) if i % n == k]
    shots = os.path.join(a.out, "_screenshots")
    os.makedirs(shots, exist_ok=True)
    man = open(os.path.join(a.out, "manifest-shard%d.jsonl" % k), "w", encoding="utf-8")
    for i, job in enumerate(jobs):
        settings = open(os.path.join(job_dir, job["settings"]), "rb").read()
        rec = assemble_one(os.path.join(a.corpus, job["source"]), job["source"], settings,
                           os.path.join(a.out, job["out"]), shots, a.timeout)
        rec["options"] = job["options"]
        rec["id"] = job["id"]
        man.write(json.dumps(rec) + "\n")
        man.flush()
        print("[%d/%d] %s %s (%s) %ss %s" % (i + 1, len(jobs), rec["status"], job["source"], job["options"],
                                             rec["seconds"], rec.get("error") or ""), flush=True)
    man.close()
    xwin.kill_exe("EDIT68K.exe")


def main():
    if sys.argv[1:] == ["--self-test"]:
        sys.exit(self_test())
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--jobs", help="JSON-lines job file (see the module text)")
    ap.add_argument("--list", help="file of corpus-relative paths, one per line")
    ap.add_argument("--options", default="default")
    ap.add_argument("--out", required=True)
    ap.add_argument("--shard", default="0/1")
    ap.add_argument("--timeout", type=float, default=300)
    a = ap.parse_args()
    k, n = (int(x) for x in a.shard.split("/"))
    if a.jobs:
        run_jobs(a, k, n)
        return
    if not a.list:
        ap.error("one of --jobs and --list is required")
    shipped = open("/mnt/official/settings.dat", "rb").read()
    settings = make_settings(shipped, a.options)
    rels = [l.rstrip("\n") for l in open(a.list, encoding="utf-8") if l.strip()]
    rels = [r for i, r in enumerate(rels) if i % n == k]
    base = os.path.join(a.out, a.options)
    shots = os.path.join(base, "_screenshots")
    os.makedirs(shots, exist_ok=True)
    man = open(os.path.join(base, "manifest-shard%d.jsonl" % k), "w", encoding="utf-8")
    for i, rel in enumerate(rels):
        rec = assemble_one(os.path.join(a.corpus, rel), rel, settings,
                           os.path.join(base, rel), shots, a.timeout)
        rec["options"] = a.options
        man.write(json.dumps(rec) + "\n")
        man.flush()
        print("[%d/%d] %s %s %ss %s" % (i + 1, len(rels), rec["status"], rel, rec["seconds"],
                                        rec.get("error") or ""), flush=True)
    man.close()
    xwin.kill_exe("EDIT68K.exe")


if __name__ == "__main__":
    main()
