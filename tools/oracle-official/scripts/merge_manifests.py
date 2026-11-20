#!/usr/bin/env python3
"""Merge asm/<options>/manifest-shard*.jsonl into asm/<options>/manifest.json.

Records already in manifest.json are kept unless a shard has a newer record
for the same source (so a re-run of some files replaces just those)."""
import glob
import json
import os
import sys

base = sys.argv[1]
for d in sorted(glob.glob(os.path.join(base, "*"))):
    shards = sorted(glob.glob(os.path.join(d, "manifest-shard*.jsonl")))
    if not shards:
        continue
    old = {}
    mf = os.path.join(d, "manifest.json")
    if os.path.exists(mf):
        with open(mf, encoding="utf-8") as f:
            old = {r["source"]: r for r in json.load(f)["files"]}
    recs = []
    for s in shards:
        with open(s, encoding="utf-8") as f:
            recs += [json.loads(l) for l in f if l.strip()]
    new = {r["source"]: r for r in recs}
    old.update(new)
    recs = sorted(old.values(), key=lambda r: r["source"])
    summary = {
        "options": os.path.basename(d),
        "tool": "official EDIT68K.exe v5.16.1 under Wine (easy68k-oracle-official image)",
        "total": len(recs),
        "ok": sum(r["status"] == "ok" for r in recs),
        "failed": sum(r["status"] != "ok" for r in recs),
        "reliable": sum(bool(r.get("reliable")) for r in recs),
        "unreliable_richedit": [r["source"] for r in recs
                                if r["status"] == "ok" and not r.get("richedit", {}).get("identical")],
        "with_assembly_errors": sum((r.get("errors") or 0) > 0 for r in recs),
    }
    with open(os.path.join(d, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"summary": summary, "files": recs}, f, indent=1)
    for s in shards:
        os.remove(s)
    print(json.dumps(summary, indent=1))
