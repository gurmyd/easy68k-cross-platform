#!/usr/bin/env python3
"""Compare the official EDIT68K v5.16.1 outputs (from run-asm-corpus.sh) with the
v5.15.4 command-line port (asy68k.exe, docs/porting/toolchain.md section 4) on the
same sources and options, and classify every difference.

Runs on the Windows host (asy68k.exe is our own native build, not an official binary):
  python tools/oracle-official/compare_cli.py [--jobs 8]
Writes build/ground-truth/cli-compare/<options>/{report.json,summary.txt}.

The corpus is copied to build/ground-truth/cli-compare/work/ first, because
asy68k writes its outputs next to the source.
"""
import argparse
import concurrent.futures as cf
import json
import os
import re
import shutil
import subprocess
from collections import Counter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
GT = os.path.join(ROOT, "build", "ground-truth")
CLI = os.path.join(ROOT, "build", "oracle", "asm-cli-5.15.4", "bin", "asy68k.exe")
CORPUS = os.path.join(ROOT, "reference", "examples")
OPTS = {"default": [], "expand": ["--macroexpand", "--structureexpan", "--expandconstants"]}


def copy_corpus(work):
    if os.path.isdir(work):
        shutil.rmtree(work)
    shutil.copytree(CORPUS, work, ignore=shutil.ignore_patterns(".git", "_downloads"))


def run_cli(src, extra):
    stem = os.path.splitext(src)[0]
    for e in (".L68", ".S68"):
        if os.path.exists(stem + e):
            os.remove(stem + e)
    # like the editor (mainS.cpp:370), run in the source's folder so INCLUDEs resolve
    r = subprocess.run([CLI, *extra, src], capture_output=True, timeout=600, cwd=os.path.dirname(src))
    out = {}
    for e in (".L68", ".S68"):
        p = stem + e
        out[e] = open(p, "rb").read() if os.path.exists(p) else None
    return out, r.returncode


def body(l68):
    """Listing lines without the header (title / date lines)."""
    lines = l68.decode("latin-1").replace("\r\n", "\n").split("\n")
    out = []
    for ln in lines:
        if re.match(r"^\d{8} Starting Address$", ln):
            continue
        if ln.startswith("Assembler used:") or ln.startswith("Created On:"):
            continue
        out.append(ln)
    while out and out[0].strip() == "":
        out.pop(0)
    return out


HEX = re.compile(r"\b[0-9A-F]{2,8}\b")


def n0(line):
    return re.sub(r"\s+", "", line or "").upper()


def mask_obj(line):
    """Mask hex words in the address/object-code part of a listing line."""
    return HEX.sub("#", (line or "")[:36]) + (line or "")[36:]


def classify_pair(a, b, ctx):
    """a = official line, b = CLI line (either may be None); ctx = file facts."""
    if b is not None and b.startswith("Could not open file"):
        return "cli-only: 'Could not open file' listing line"
    if (b or "").find("*~Font") >= 0 or (b or "").find("*~Tab") >= 0 or \
       "END directive missing" in (a or "") or "END directive missing" in (b or ""):
        return "editor strips *~Font/*~Tab trailer, CLI assembles it"
    if a is not None and b is not None:
        if n0(a) == n0(b):
            return "format: tab expansion / hex letter case"
        if n0(mask_obj(a)) == n0(mask_obj(b)):
            if re.search(r",PC,|\(PC,", a, re.I):
                return "5.16.1 change: (label,PC,Xn) displacement $FE"
            if ctx["official_undefined"]:
                return "object code of a line with an undefined symbol (uninitialised value)"
            return "object code differs (other)"
        if "Invalid syntax" in a and "Invalid syntax" not in b:
            return "5.16.1 change: (d,An) displacement starting P / 2nd char C -> Invalid syntax"
    if ctx["cli_include_regression"]:
        return "cli-only: INCLUDE/INCBIN line not upper-cased (cascade)"
    if ctx["cli_could_not_open"]:
        return "cascade of a missing include in the CLI"
    if ctx["official_undefined"] and (a is None or b is None):
        return "line-count, file has undefined symbols"
    return "other"


def cli_include_regression(ob, cb):
    """CLI-only bug (assembler.md 8.2): a line that contains INCLUDE/INCBIN anywhere
    is not upper-cased, so a lower-case directive becomes 'Invalid opcode'."""
    official_errs = set(re.findall(r"^Line (\d+) ERROR: Invalid opcode", "\n".join(ob), re.M))
    for i, ln in enumerate(cb[:-1]):
        m = re.match(r"^Line (\d+) ERROR: Invalid opcode", ln)
        if m and m.group(1) not in official_errs and re.search(r"include|incbin", cb[i + 1], re.I):
            return True
    return False


def compare(official_dir, cli_out):
    res = {"s68_equal": None, "l68_equal_body": None, "classes": {}, "examples": []}

    def pick(ext):
        try:
            f = [f for f in os.listdir(official_dir) if f.upper().endswith(ext)][0]
            return open(os.path.join(official_dir, f), "rb").read()
        except (IndexError, FileNotFoundError):
            return None
    o_l, o_s = pick(".L68"), pick(".S68")
    c_l, c_s = cli_out[".L68"], cli_out[".S68"]
    res["s68_equal"] = (o_s == c_s)
    res["s68_present"] = [o_s is not None, c_s is not None]
    if o_l is None or c_l is None:
        res["l68_present"] = [o_l is not None, c_l is not None]
        return res
    ob, cb = body(o_l), body(c_l)
    res["l68_equal_body"] = ob == cb
    if ob == cb:
        return res
    otext, ctext = "\n".join(ob), "\n".join(cb)
    ctx = {
        "official_undefined": "ERROR: Undefined symbol" in otext,
        "cli_could_not_open": "Could not open file" in ctext,
        "cli_include_regression": cli_include_regression(ob, cb),
    }
    import difflib
    sm = difflib.SequenceMatcher(None, [n0(x) for x in ob], [n0(x) for x in cb], autojunk=False)
    cls = Counter()
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            # equal after removing white space: still a formatting difference
            for i, j in zip(range(i1, i2), range(j1, j2)):
                if ob[i] != cb[j]:
                    cls["format: tab expansion / hex letter case"] += 1
            continue
        a_lines, b_lines = ob[i1:i2], cb[j1:j2]
        for k in range(max(len(a_lines), len(b_lines))):
            a = a_lines[k] if k < len(a_lines) else None
            b = b_lines[k] if k < len(b_lines) else None
            c = classify_pair(a, b, ctx)
            cls[c] += 1
            if len([e for e in res["examples"] if e["class"] == c]) < 2:
                res["examples"].append({"class": c, "official": a, "cli": b})
    res["classes"] = dict(cls)
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=8)
    ap.add_argument("--keep-work", action="store_true")
    a = ap.parse_args()
    outbase = os.path.join(GT, "cli-compare")
    os.makedirs(outbase, exist_ok=True)
    for opt, extra in OPTS.items():
        man = json.load(open(os.path.join(GT, "asm", opt, "manifest.json"), encoding="utf-8"))
        work = os.path.join(outbase, "work-" + opt)
        copy_corpus(work)
        recs = [r for r in man["files"] if r["status"] == "ok"]

        def one(r):
            src = os.path.join(work, r["source"].replace("/", os.sep))
            try:
                out, rc = run_cli(src, extra)
            except subprocess.TimeoutExpired:
                return {"source": r["source"], "error": "cli timeout"}
            res = compare(os.path.join(GT, "asm", opt, r["source"].replace("/", os.sep)), out)
            res["source"] = r["source"]
            res["cli_exit"] = rc
            res["official_errors"] = r.get("errors")
            m = re.search(rb"^(\d+) errors? detected", out[".L68"] or b"", re.M)
            res["cli_errors"] = int(m.group(1)) if m else (0 if b"No errors detected" in (out[".L68"] or b"") else None)
            return res

        with cf.ThreadPoolExecutor(a.jobs) as ex:
            results = list(ex.map(one, recs))
        results.sort(key=lambda r: r["source"])
        totals = Counter()
        files_by_class = {}
        for r in results:
            for c, n in r.get("classes", {}).items():
                totals[c] += n
                files_by_class.setdefault(c, []).append(r["source"])
        summary = {
            "options": opt,
            "compared": len(results),
            "s68_identical": sum(1 for r in results if r.get("s68_equal")),
            "l68_body_identical": sum(1 for r in results if r.get("l68_equal_body")),
            "error_count_differs": [r["source"] for r in results
                                    if r.get("official_errors") != r.get("cli_errors")],
            "differing_lines_by_class": dict(totals),
            "files_by_class": {c: len(v) for c, v in files_by_class.items()},
        }
        od = os.path.join(outbase, opt)
        os.makedirs(od, exist_ok=True)
        json.dump({"summary": summary, "files": results}, open(os.path.join(od, "report.json"), "w"), indent=1)
        print(json.dumps(summary, indent=1))
        if not a.keep_work:
            shutil.rmtree(work)


if __name__ == "__main__":
    main()
