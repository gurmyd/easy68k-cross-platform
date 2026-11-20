#!/usr/bin/env python3
"""Run a program in the OFFICIAL SIM68K.exe under Wine and collect results.

Runs inside the easy68k-oracle-official container (see ../README.md).

Recipe "selfreport" (fast, no UI automation beyond start-up):
  SIM68K.exe prog.S68 /r [/e] [/b]; the 68000 program writes its own report
  with dumplib.X68 (TRAP #15 file tasks) ending in the line END-OF-DUMP. We
  wait for that line (task 56 closed the file, so it is complete), screenshot
  the display if asked, then kill the simulator (it never exits by itself).

Recipe "log" (execution log through the UI):
  write sim68K.dat with the exec-log type byte (and output-log byte), start
  without /r, Ctrl+F4 (Log Start), then drive the program:
    --drive autotrace : Options > Auto Trace Options... OK (applies the interval
                        from sim68K.dat, min 10 ms) then F10 (Auto Trace);
    --drive step      : F7 (Trace Into) once per instruction, each press sent
                        only after the previous step reached the log;
    --drive run       : F9 (Run) - gives only the text-output log and the log
                        header (instruction lines are written only in trace mode).
  At the halt the simulator shows "Current Log Stopped." (title Information);
  we press Enter, exit with Alt+F4 and collect <name>_RunLog.txt / _OutLog.txt.

Usage:
  sim_run.py selfreport PROG.S68 --dump NAME [--args "/e /b"] [--timeout 60]
             [--screenshot out.png] [--out DIR]
  sim_run.py log PROG.S68 --exec-log 0..3 [--out-log 0|1] [--drive autotrace|step|run]
             [--interval 10] [--max-steps N] [--timeout 600] [--out DIR]
Prints one JSON object with the result.
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

EXE_DIR = "/opt/easy68k"
INFO_RX = r"^Information$"


def write_sim_dat(exec_log=0, out_log=0, exceptions=None, bitfield=None, interval=None,
                  no_display=None):
    lines = open("/mnt/official/sim68K.dat", "rb").read().split(b"\r\n")
    out = []
    for ln in lines:
        tail = ln[1:]
        if tail == b"$exec log":
            ln = bytes([exec_log]) + tail
        elif tail == b"$output log":
            ln = bytes([out_log]) + tail
        elif tail == b"$exceptions" and exceptions is not None:
            ln = (b"1" if exceptions else b"0") + tail
        elif tail == b"$bit field enabled" and bitfield is not None:
            ln = (b"1" if bitfield else b"0") + tail
        elif tail == b"$disable display" and no_display is not None:
            ln = (b"1" if no_display else b"0") + tail
        elif ln.endswith(b"$auto trace interval") and interval is not None:
            ln = str(interval).encode() + b"$auto trace interval"
        out.append(ln)
    with open(os.path.join(EXE_DIR, "sim68K.dat"), "wb") as f:
        f.write(b"\r\n".join(out))


def start(prog, args):
    d = os.path.dirname(os.path.abspath(prog))
    log = open("/tmp/sim68k-wine.log", "ab")
    cmd = ["wine", os.path.join(EXE_DIR, "SIM68K.exe"), xwin.winpath(prog)] + args
    p = subprocess.Popen(cmd, cwd=d, stdout=log, stderr=log, start_new_session=True)
    title_rx = "^" + xwin.winpath(prog).replace("\\", "\\\\").replace(".", r"\.") + "$"
    main = xwin.wait_for(title_rx, 30)
    return p, main


def stop(p, graceful):
    how = "killed"
    if graceful and p.poll() is None:
        main = xwin.find(r"\.S68$")
        if main:
            xwin.key(main[0], "alt+F4")
            end = time.monotonic() + 10
            while p.poll() is None and time.monotonic() < end:
                time.sleep(0.1)
            if p.poll() is not None:
                how = "clean"
    if p.poll() is None:
        if not xwin.kill_exe("SIM68K.exe"):
            xwin.wine_reset()
    try:
        p.wait(5)
    except subprocess.TimeoutExpired:
        xwin.wine_reset()
    return how


def selfreport(a):
    t0 = time.monotonic()
    d = os.path.dirname(os.path.abspath(a.prog))
    dump = os.path.join(d, a.dump)
    if os.path.exists(dump):
        os.remove(dump)
    write_sim_dat(exceptions=a.exceptions, bitfield=a.bitfield)
    res = {"recipe": "selfreport", "prog": a.prog, "args": a.args, "ok": False}
    p, main = start(a.prog, ["/r"] + a.args.split())
    try:
        if not main:
            raise RuntimeError("simulator window did not appear")
        end = time.monotonic() + a.timeout
        while time.monotonic() < end:
            if os.path.exists(dump) and b"END-OF-DUMP\r\n" in open(dump, "rb").read():
                res["ok"] = True
                break
            if p.poll() is not None:
                raise RuntimeError("simulator exited")
            time.sleep(0.05)
        if not res["ok"]:
            raise RuntimeError("no complete dump within %ss" % a.timeout)
        res["seconds_to_dump"] = round(time.monotonic() - t0, 2)
        if a.screenshot:
            time.sleep(a.settle)
            os.makedirs(os.path.dirname(os.path.abspath(a.screenshot)), exist_ok=True)
            io = xwin.find(r"^Sim68K I/O$")
            if io:
                # Without a compositor, parts of a window covered by another
                # window are never drawn on the X screen. Raise the output
                # window so it is fully exposed and repainted before capture.
                main = xwin.find(r"\.S68$")
                if main:
                    subprocess.run(["xdotool", "windowmove", main[0], "0", "1100"], capture_output=True)
                subprocess.run(["xdotool", "windowraise", io[0]], capture_output=True)
                time.sleep(a.settle)
            res["screenshot"] = xwin.screenshot(a.screenshot, io[0] if io else None) and a.screenshot
    except Exception as e:  # noqa: BLE001
        res["error"] = str(e)
        shot = os.path.join(a.out or "/tmp", "fail-screen.png")
        os.makedirs(os.path.dirname(shot), exist_ok=True)
        if xwin.screenshot(shot):
            res["fail_screenshot"] = shot
        res["windows"] = [w[1] for w in xwin.real_windows()]
    finally:
        res["exit"] = stop(p, graceful=False)
    if os.path.exists(dump):
        res["dump"] = open(dump, "rb").read().decode("latin-1")
        if a.out:
            os.makedirs(a.out, exist_ok=True)
            shutil.copy2(dump, os.path.join(a.out, a.dump))
    res["seconds"] = round(time.monotonic() - t0, 2)
    return res


def count_instr(path):
    try:
        with open(path, "rb") as f:
            return f.read().count(b"\nPC=")
    except FileNotFoundError:
        return 0


def log_run(a):
    t0 = time.monotonic()
    d = os.path.dirname(os.path.abspath(a.prog))
    stem = os.path.splitext(os.path.basename(a.prog))[0]
    runlog = os.path.join(d, stem + "_RunLog.txt")
    outlog = os.path.join(d, stem + "_OutLog.txt")
    for f in (runlog, outlog):
        if os.path.exists(f):
            os.remove(f)       # else a Replace/Append/Cancel dialog appears
    write_sim_dat(exec_log=a.exec_log, out_log=a.out_log, interval=a.interval,
                  exceptions=a.exceptions, bitfield=a.bitfield, no_display=a.no_display)
    res = {"recipe": "log", "prog": a.prog, "drive": a.drive, "exec_log": a.exec_log,
           "out_log": a.out_log, "ok": False}
    p, main = start(a.prog, a.args.split())
    try:
        if not main:
            raise RuntimeError("simulator window did not appear")
        wid = main[0]
        time.sleep(0.5)
        if a.drive == "autotrace":
            xwin.key(wid, "alt+o")
            xwin.key(wid, "a")                  # &Auto Trace Options...
            dlg = xwin.wait_for(r"^Auto Trace Options$", 5)
            if not dlg:
                raise RuntimeError("Auto Trace Options dialog did not open")
            xwin.key(dlg[0], "alt+o")           # &OK applies the interval to the timer
            if not xwin.wait_gone(dlg[0], 5):
                raise RuntimeError("Auto Trace Options dialog did not close")
        xwin.key(wid, "ctrl+F4")                # Log Start
        end = time.monotonic() + 5
        while time.monotonic() < end and not (os.path.exists(runlog) or os.path.exists(outlog)):
            time.sleep(0.05)
        t_start = time.monotonic()
        stopped = None
        deadline = t_start + a.timeout
        if a.drive == "autotrace":
            xwin.key(wid, "F10")
            stopped = xwin.wait_for(INFO_RX, a.timeout, poll=0.25)
        elif a.drive == "run":
            xwin.key(wid, "F9")
            stopped = xwin.wait_for(INFO_RX, a.timeout, poll=0.1)
        else:  # step
            steps = 0
            size = os.path.getsize(runlog) if os.path.exists(runlog) else 0
            focus = True
            while time.monotonic() < deadline and steps < a.max_steps:
                if focus:
                    xwin.key(wid, "F7")
                    focus = False
                else:
                    xwin.press("F7")
                steps += 1
                t_key = time.monotonic()
                grew = False
                while time.monotonic() - t_key < 0.5:
                    m = os.path.getsize(runlog)
                    if m > size:
                        size = m
                        grew = True
                        # the log line is written before the display update;
                        # a key that arrives during the update is dropped
                        time.sleep(a.step_gap)
                        break
                    time.sleep(0.002)
                if not grew:
                    # nothing logged: halted (message box up) or focus lost
                    w = xwin.find(INFO_RX)
                    if w:
                        stopped = w
                        break
                    focus = True
                    steps -= 1
            res["keys_sent"] = steps
            if not stopped:
                stopped = xwin.wait_for(INFO_RX, 2)
        res["run_seconds"] = round(time.monotonic() - t_start, 2)
        if not stopped:
            raise RuntimeError("no 'Current Log Stopped.' message (program did not halt in time)")
        xwin.key(stopped[0], "Return")
        xwin.wait_gone(stopped[0], 5)
        res["ok"] = True
    except Exception as e:  # noqa: BLE001
        res["error"] = str(e)
        xwin.screenshot("/tmp/sim-fail.png")
    finally:
        res["exit"] = stop(p, graceful=True)
    res["instructions_logged"] = count_instr(runlog)
    if res.get("run_seconds"):
        res["instructions_per_second"] = round(res["instructions_logged"] / res["run_seconds"], 1)
    for f in (runlog, outlog):
        if os.path.exists(f) and a.out:
            os.makedirs(a.out, exist_ok=True)
            shutil.copy2(f, os.path.join(a.out, os.path.basename(f)))
    res["files"] = [os.path.basename(f) for f in (runlog, outlog) if os.path.exists(f)]
    res["seconds"] = round(time.monotonic() - t0, 2)
    return res


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("selfreport")
    s.add_argument("prog")
    s.add_argument("--dump", required=True)
    s.add_argument("--args", default="")
    s.add_argument("--timeout", type=float, default=60)
    s.add_argument("--screenshot")
    s.add_argument("--settle", type=float, default=1.0)
    s.add_argument("--out")
    s.add_argument("--exceptions", type=int, choices=[0, 1])
    s.add_argument("--bitfield", type=int, choices=[0, 1])
    l = sub.add_parser("log")
    l.add_argument("prog")
    l.add_argument("--exec-log", type=int, default=2)
    l.add_argument("--out-log", type=int, default=0)
    l.add_argument("--drive", choices=["autotrace", "step", "run"], default="step")
    l.add_argument("--interval", type=int, default=10)
    l.add_argument("--max-steps", type=int, default=100000)
    l.add_argument("--step-gap", type=float, default=0.08,
                   help="pause after each logged step before the next F7 (s)")
    l.add_argument("--timeout", type=float, default=600)
    l.add_argument("--args", default="")
    l.add_argument("--exceptions", type=int, choices=[0, 1])
    l.add_argument("--bitfield", type=int, choices=[0, 1])
    l.add_argument("--no-display", type=int, choices=[0, 1], default=1,
                   help="'Disable display update' during Auto Trace (sim68K.dat), default 1")
    l.add_argument("--out")
    a = ap.parse_args()
    res = selfreport(a) if a.cmd == "selfreport" else log_run(a)
    print(json.dumps(res))
    sys.exit(0 if res["ok"] else 1)


if __name__ == "__main__":
    main()
