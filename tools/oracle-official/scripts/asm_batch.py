#!/usr/bin/env python3
"""Assemble .X68 sources with the OFFICIAL EDIT68K.exe under Wine.

Runs inside the easy68k-oracle-official container (see ../README.md).

For each source: write settings.dat, start EDIT68K.exe with the file, press F9,
dismiss "Assembler Status" with Alt+C (its Close button - never Enter, which
would press Execute and start the simulator), close with Alt+F4 (answering No
to any save prompt), collect <name>.L68 / <name>.S68, and capture the exact
text the editor handed to the assembler (EASy68Ks.tmp, see below).

Capturing EASy68Ks.tmp: the editor writes the buffer to EASy68Ks.tmp beside the
source, assembles, and deletes it (mainS.cpp:371-375). Before starting we create
an empty EASy68Ks.tmp and a hard link to it elsewhere. Wine opens the existing
file with CREATE_ALWAYS (truncate, same inode), so after DeleteFile removes the
name our link still holds exactly the bytes the assembler read.

Usage:
  asm_batch.py --corpus /work/corpus --list files.txt --options default|expand
               --out /mnt/out/asm --shard 0/1 [--timeout 90]
Writes <out>/<options>/<rel>/{name.L68,name.S68,name.received.txt} and
<out>/<options>/manifest-shard<k>.jsonl (one JSON object per source).
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
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


def handle_stray(rec, shots_dir, tag, known_rx):
    """Dismiss any visible window that is not one we expect. Returns titles seen."""
    import re
    seen = []
    for wid, title, w, h in xwin.real_windows():
        if any(re.search(rx, title) for rx in known_rx):
            continue
        seen.append(title)
        shot = os.path.join(shots_dir, "%s-%d.png" % (tag, len(rec["stray_windows"])))
        xwin.screenshot(shot)
        rec["stray_windows"].append({"title": title, "screenshot": shot})
        if title.startswith("Confirm"):
            xwin.key(wid, "n")          # "File modified, save?" -> No
        else:
            xwin.key(wid, "Return")     # message boxes: OK
        xwin.wait_gone(wid, 3)
    return seen


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
    rec = {"source": rel, "status": "fail", "error": None, "stray_windows": [],
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
    known = [MAIN_RX, STATUS_RX]
    try:
        deadline = t0 + timeout
        tag = rel.replace("/", "_")

        def watch():
            # stop waiting early if the editor died (e.g. a crash) or a stray box appeared
            if proc.poll() is not None:
                return "exited"
            return handle_stray(rec, shots_dir, tag, known) or None

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

        closed = False
        for _ in range(3):
            # a modal box above the status dialog (e.g. a VCL "Access violation"
            # raised while assembling) must be dismissed first
            for wid, title, w, h in xwin.real_windows():
                if wid not in (status[0], main[0]):
                    shot = os.path.join(shots_dir, "%s-%d.png" % (tag, len(rec["stray_windows"])))
                    xwin.screenshot(shot)
                    rec["stray_windows"].append({"title": title, "screenshot": shot, "when": "after assembly"})
                    xwin.key(wid, "Return")
                    xwin.wait_gone(wid, 3)
            xwin.key(status[0], "alt+c")
            if xwin.wait_gone(status[0], 4):
                closed = True
                break
        if not closed:
            raise RuntimeError("Assembler Status dialog did not close on Alt+C")

        rec["t_closed"] = round(time.monotonic() - t0, 2)
        # exit the editor
        main = xwin.find(MAIN_RX) or main
        xwin.key(main[0], "alt+F4")
        end = time.monotonic() + 15
        while proc.poll() is None and time.monotonic() < end:
            handle_stray(rec, shots_dir, rel.replace("/", "_"), [MAIN_RX])
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
        import re
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--list", required=True, help="file of corpus-relative paths, one per line")
    ap.add_argument("--options", default="default")
    ap.add_argument("--out", required=True)
    ap.add_argument("--shard", default="0/1")
    ap.add_argument("--timeout", type=float, default=300)
    a = ap.parse_args()
    k, n = (int(x) for x in a.shard.split("/"))
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
