"""Small helpers for driving Wine programs on an Xvfb display with xdotool.

Wine without a window manager: every top-level Win32 window (main forms,
modal dialogs, message boxes) is its own X window whose name is the Win32
caption. Controls inside a window are not X windows, so buttons are reached
through their keyboard accelerators (Alt+letter).
"""
import os
import re
import signal
import subprocess
import time


def _xdo(*args, timeout=10):
    r = subprocess.run(["xdotool", *args], capture_output=True, text=True, timeout=timeout)
    return r.stdout


def windows():
    """List visible top-level windows as (id, title, w, h)."""
    out = []
    for wid in _xdo("search", "--onlyvisible", "--name", "").split():
        try:
            name = _xdo("getwindowname", wid).rstrip("\n")
            geo = _xdo("getwindowgeometry", "--shell", wid)
        except subprocess.TimeoutExpired:
            continue
        m_w = re.search(r"WIDTH=(\d+)", geo)
        m_h = re.search(r"HEIGHT=(\d+)", geo)
        w = int(m_w.group(1)) if m_w else 0
        h = int(m_h.group(1)) if m_h else 0
        out.append((wid, name, w, h))
    return out


def real_windows():
    """Visible windows that are real dialogs/forms (skip root and 1x1 app windows)."""
    return [w for w in windows() if w[1] and w[2] > 1 and w[3] > 1]


def find(pattern):
    rx = re.compile(pattern)
    for w in real_windows():
        if rx.search(w[1]):
            return w
    return None


def wait_for(pattern, timeout, poll=0.1, also=None):
    """Wait until a window whose title matches `pattern` is visible.

    `also`: optional callable run every poll; if it returns a non-None value
    the wait stops early and that value is returned as ('abort', value).
    Returns the window tuple, None on timeout.
    """
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        w = find(pattern)
        if w:
            return w
        if also:
            v = also()
            if v is not None:
                return ("abort", v)
        time.sleep(poll)
    return None


def wait_gone(wid, timeout, poll=0.1):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if wid not in [w[0] for w in real_windows()]:
            return True
        time.sleep(poll)
    return False


def key(wid, *keys):
    """Give `wid` the X input focus, then send key strokes to it."""
    _xdo("windowfocus", wid)
    time.sleep(0.05)
    _xdo("key", "--clearmodifiers", *keys)


def press(*keys):
    """Send key strokes to whatever window has the focus (no focus change)."""
    _xdo("key", *keys)


def type_text(wid, text):
    _xdo("windowfocus", wid)
    time.sleep(0.05)
    _xdo("type", "--delay", "1", text)


def screenshot(path, wid=None):
    try:
        target = wid if wid else "root"
        subprocess.run(["import", "-window", target, path], capture_output=True, timeout=20)
        return os.path.exists(path)
    except Exception:
        return False


def winpath(unix_path):
    """Unix path inside the container -> Wine path on drive Z:."""
    return "Z:" + os.path.abspath(unix_path).replace("/", "\\")


def pids_of(exe_name):
    # "[E]DIT68K.exe" style pattern so pgrep never matches a shell that names it
    pat = "[" + exe_name[0] + "]" + exe_name[1:].replace(".", r"\.")
    r = subprocess.run(["pgrep", "-f", pat], capture_output=True, text=True)
    return [int(p) for p in r.stdout.split()]


def kill_exe(exe_name, wait=5.0):
    """Kill every process whose command line contains exe_name; True if gone."""
    for p in pids_of(exe_name):
        try:
            os.kill(p, signal.SIGKILL)
        except ProcessLookupError:
            pass
    end = time.monotonic() + wait
    while time.monotonic() < end:
        if not pids_of(exe_name):
            return True
        time.sleep(0.1)
    return not pids_of(exe_name)


def wine_reset():
    """Last resort: stop every Wine process in this prefix."""
    subprocess.run(["wineserver", "-k"], capture_output=True)
    time.sleep(0.5)
