# Request T3: the simulator scripts in the Wine oracle image

Status: open (for the owner of `tests/oracle/wine/Dockerfile`, T1, at the next gate)

## What

In `tests/oracle/wine/Dockerfile`, change the line

```
COPY sim/sim_run.py sim/sim_proofs.sh /oracle/
```

to

```
COPY sim/sim_run.py /oracle/
```

After that change T3 deletes `tests/oracle/wine/sim/sim_proofs.sh`.

## Why

- `sim_proofs.sh` ran the first proof of the simulator recipes (official-oracle.md 5.1, 5.2) on
  the programs of `tests/oracle/wine/sim/tests/`. T3 moved those programs into the conformance
  suite (`tests/conformance/sim/instructions/p*.X68`, `tests/conformance/sim/logs/l01-l05`), so the
  script now names files that no longer exist. It cannot be deleted while the Dockerfile copies it:
  `docker build` would fail, and `assertImageCurrent` (`common/docker.mjs`) would refuse every run.
- The simulator driver itself (`sim_batch.py`, `sim_corpus.sh`) is not copied into the image on
  purpose: `regenerate.mjs` mounts `tests/oracle/wine/sim` read-only at `/mnt/sim-driver` and runs it
  from there, so a change of the driver needs no image rebuild and does not invalidate the image
  T1's assembler runs check. `sim_batch.py` imports `sim_run.py` from its own folder, so even
  `sim/sim_run.py` could leave the COPY line; it is kept there because it is the script the
  measurements of official-oracle.md section 5 were made with.
- `oracle.yml`'s image cache key hashes `tests/oracle/wine/sim/*.sh` and `*.py`. With the driver
  mounted, those files no longer decide the image; the key could name only what the COPY lines
  copy. Not needed for correctness (a needless rebuild costs three minutes).

## Meanwhile

Nothing is blocked: the image as it is runs the T3 driver from the mount.
