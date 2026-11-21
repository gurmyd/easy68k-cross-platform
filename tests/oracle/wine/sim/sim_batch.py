#!/usr/bin/env python3
"""Run the simulator conformance programs in the OFFICIAL SIM68K.exe under Wine.

Runs inside the easy68k-oracle-wine container, started by sim_corpus.sh (see README.md). This
file is not copied into the image: regenerate.mjs mounts this folder read-only at /mnt/sim-driver
and runs it from there, so the image needs no rebuild when the simulator driver changes.

For every job of a job list:

  1. assemble the program with the official EDIT68K.exe (asm_batch.assemble_one, the shipped
     settings.dat: the default options), once per source;
  2. copy the .S68 and .L68 (and the job's data files) into a fresh run folder;
  3. run it with one recipe of sim_run.py (unchanged since official-oracle.md section 5):
       report  SIM68K.exe prog.S68 /r [switches]; the program writes result.bin with dumplib.X68
               and ends it with the line END-OF-DUMP; the simulator is killed after that;
       outlog  the text-output log of a Run (sim68K.dat output-log byte 1, Log Start, F9) up to
               the "Current Log Stopped." box at the halt;
       log     the execution log of an Auto Trace (sim68K.dat exec-log type byte, Log Start, the
               Auto Trace Options dialog's OK to apply the 10 ms interval, F10), optionally with
               the text-output log as well;
  4. collect what the recipe produced into the job's output folder.

  sim_batch.py --corpus /work/sim --jobs /mnt/job/jobs.jsonl --out /mnt/out [--shard K/N]

jobs.jsonl has one JSON object per line (written by regenerate.mjs):
  {"id": "trap15-a/t14-text-ab:report", "source": "trap15-a/t14-text-ab.X68",
   "recipe": "report" | "outlog" | "log", "switches": "/e /b", "exceptions": null | 0 | 1,
   "bitfield": null | 0 | 1, "execLog": 0..3, "outLog": 0 | 1, "timeout": 60,
   "files": ["data.bin"], "out": "<folder below --out>"}

Writes <out>/<job out>/ (prog.S68, prog.L68, result.bin, <stem>_RunLog.txt, <stem>_OutLog.txt,
fail-screen.png) and <out>/manifest-shard<K>.jsonl, one JSON object per job:
  {"id", "recipe", "status": "ok" | "failed", "error", "asm": {...asm_batch record...},
   "run": {...sim_run record without the dump text...}, "files": [...], "seconds"}
"""
import argparse
import json
import os
import shutil
import sys
import time
import types

# sim_run.py is beside this file; asm_batch.py and xwin.py are in the image's /oracle (in the
# repository they are in ../asm and ../common).
_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [_HERE, "/oracle", os.path.join(os.path.dirname(_HERE), "common"),
                os.path.join(os.path.dirname(_HERE), "asm")]
import xwin  # noqa: E402

EXE_DIR = "/opt/easy68k"
RESULT_FILE = "result.bin"


def assemble(corpus, source, cache, shots):
    """Assembles `source` (a path below `corpus`) once; returns (record, folder with the outputs)."""
    if source in cache:
        return cache[source]
    import asm_batch  # noqa: E402  (needs a display; imported only when used)
    settings = open(os.path.join(EXE_DIR, "settings.dat.shipped"), "rb").read()
    out_dir = os.path.join("/work/asm", source.replace("/", "__"))
    rec = asm_batch.assemble_one(os.path.join(corpus, source), source, settings, out_dir, shots, 300)
    cache[source] = (rec, out_dir)
    return cache[source]


def stem_of(source):
    return os.path.splitext(os.path.basename(source))[0]


def find_case(directory, name):
    """The file `name` in `directory`, matched without regard to letter case (the official
    programs write the names the way the program spelt them)."""
    if not os.path.isdir(directory):
        return None
    for entry in os.listdir(directory):
        if entry.lower() == name.lower():
            return os.path.join(directory, entry)
    return None


def run_job(job, corpus, out_root, cache, shots):
    t0 = time.monotonic()
    import sim_run  # noqa: E402
    rec = {"id": job["id"], "recipe": job["recipe"], "status": "failed", "error": None, "files": []}
    out_dir = os.path.join(out_root, job["out"])
    os.makedirs(out_dir, exist_ok=True)
    stem = stem_of(job["source"])
    if job["source"].lower().endswith(".s68"):
        # A program assembled elsewhere (run-report.sh / run-log.sh with an .S68): run it as it is,
        # with the .L68 beside it when there is one.
        asm_dir = os.path.dirname(os.path.join(corpus, job["source"]))
        asm = {"status": "ok", "outputs": [], "note": "S-record file given; not assembled"}
    else:
        asm, asm_dir = assemble(corpus, job["source"], cache, shots)
    rec["asm"] = {k: asm.get(k) for k in ("status", "error", "errors", "warnings", "outputs", "seconds", "note")}
    s68 = find_case(asm_dir, stem + ".S68")
    l68 = find_case(asm_dir, stem + ".L68")
    if asm.get("status") != "ok" or not s68:
        rec["error"] = "the official assembler produced no S-record file: %s" % (asm.get("error") or
                                                                                  "errors=%s" % asm.get("errors"))
        rec["seconds"] = round(time.monotonic() - t0, 2)
        return rec
    for f in (s68, l68):
        if f:
            shutil.copy2(f, os.path.join(out_dir, os.path.basename(f)))

    # A fresh folder per run: the program's current directory, where it writes its files.
    run_dir = os.path.join("/work/run", job["out"])
    shutil.rmtree(run_dir, ignore_errors=True)
    os.makedirs(run_dir)
    prog = os.path.join(run_dir, stem + ".S68")
    shutil.copy2(s68, prog)
    if l68:
        shutil.copy2(l68, os.path.join(run_dir, stem + ".L68"))
    src_dir = os.path.dirname(os.path.join(corpus, job["source"]))
    for name in job.get("files", []):
        shutil.copy2(os.path.join(src_dir, name), os.path.join(run_dir, os.path.basename(name)))

    a = types.SimpleNamespace(prog=prog, args=job.get("switches", ""), timeout=job.get("timeout", 60),
                              out=out_dir, exceptions=job.get("exceptions"), bitfield=job.get("bitfield"),
                              screenshot=None, settle=1.0)
    try:
        if job["recipe"] == "report":
            a.dump = RESULT_FILE
            res = sim_run.selfreport(a)
        else:
            a.exec_log = job.get("execLog", 0)
            a.out_log = job.get("outLog", 0)
            a.drive = "run" if job["recipe"] == "outlog" else "autotrace"
            a.interval = 10
            a.max_steps = 100000
            a.step_gap = 0.08
            a.no_display = 1
            res = sim_run.log_run(a)
    except Exception as e:  # noqa: BLE001
        res = {"ok": False, "error": "driver: %s" % e}
    res.pop("dump", None)
    rec["run"] = res
    if os.path.exists("/tmp/sim-fail.png"):
        shutil.move("/tmp/sim-fail.png", os.path.join(out_dir, "fail-screen.png"))
    fail_shot = res.get("fail_screenshot")
    if fail_shot and os.path.exists(fail_shot) and os.path.dirname(fail_shot) != out_dir:
        shutil.move(fail_shot, os.path.join(out_dir, "fail-screen.png"))
    # Every file the program wrote into its folder, for the record (file-task programs).
    rec["written"] = sorted(f for f in os.listdir(run_dir)
                            if f not in (os.path.basename(prog), stem + ".L68"))
    rec["files"] = sorted(os.listdir(out_dir))
    rec["status"] = "ok" if res.get("ok") else "failed"
    rec["error"] = None if res.get("ok") else res.get("error")
    rec["seconds"] = round(time.monotonic() - t0, 2)
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", required=True)
    ap.add_argument("--jobs", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--shard", default="0/1")
    a = ap.parse_args()
    k, n = (int(x) for x in a.shard.split("/"))
    jobs = [json.loads(line) for line in open(a.jobs, encoding="utf-8") if line.strip()]
    # Jobs of one source stay in one shard, so that it is assembled once. The sources are dealt out
    # in the order of the job list, which puts the slow ones (execution logs) first.
    sources = list(dict.fromkeys(j["source"] for j in jobs))
    mine = {s for i, s in enumerate(sources) if i % n == k}
    jobs = [j for j in jobs if j["source"] in mine]
    shots = os.path.join(a.out, "_screenshots")
    os.makedirs(shots, exist_ok=True)
    # The editor rewrites settings.dat on exit; keep the shipped one to start every assembly from.
    if not os.path.exists(os.path.join(EXE_DIR, "settings.dat.shipped")):
        shutil.copy2(os.path.join(EXE_DIR, "settings.dat"), os.path.join(EXE_DIR, "settings.dat.shipped"))
    cache = {}
    with open(os.path.join(a.out, "manifest-shard%d.jsonl" % k), "w", encoding="utf-8") as man:
        for i, job in enumerate(jobs):
            try:
                rec = run_job(job, a.corpus, a.out, cache, shots)
            except Exception as e:  # noqa: BLE001
                rec = {"id": job["id"], "recipe": job["recipe"], "status": "failed", "error": "driver: %s" % e}
            man.write(json.dumps(rec) + "\n")
            man.flush()
            print("[%d/%d] %s %s %ss %s" % (i + 1, len(jobs), rec["status"], job["id"], rec.get("seconds"),
                                            rec.get("error") or ""), flush=True)
    xwin.kill_exe("SIM68K.exe")
    xwin.kill_exe("EDIT68K.exe")


if __name__ == "__main__":
    main()
