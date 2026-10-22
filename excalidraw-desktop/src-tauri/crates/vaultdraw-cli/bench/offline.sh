#!/bin/sh
# Offline-read latency of the release CLI on a generated vault.
# usage: sh bench/offline.sh [drawings=1000] [runs=50]
# Prints p50/p95 (ms) for: ls, search warm (snapshot present), search cold (state wiped each run),
# plus write (overwrite a 60-element drawing from stdin) and new, normally and under `taskpolicy -c background`. Needs python3 for the fixture and the stats.
set -eu
N=${1:-1000}; RUNS=${2:-50}
HERE=$(cd "$(dirname "$0")" && pwd)
BIN=${BIN:-$HERE/../../../target/release/vaultdraw-cli}
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
V=$T/vault; export VAULTDRAW_STATE_DIR=$T/state VAULTDRAW_RUNTIME_DIR=$T/run VAULTDRAW_CONFIG_DIR=$T/config HOME=/nonexistent
mkdir -p "$V" "$VAULTDRAW_RUNTIME_DIR" "$VAULTDRAW_STATE_DIR" "$VAULTDRAW_CONFIG_DIR"
python3 -I - "$V" "$N" <<'PY'
import json, os, random, sys
root, n = sys.argv[1], int(sys.argv[2]); random.seed(7)
words = "queue graph tree foo bar sort heap hash stack node edge flow plan note idea".split()
for i in range(n):
    d = os.path.join(root, f"f{i % 20}"); os.makedirs(d, exist_ok=True)
    els = [{"id": f"e{j}", "type": "text", "x": j, "y": j, "width": 80, "height": 20, "text": " ".join(random.choices(words, k=6)) + (" #tag%d" % (i % 9) if j == 0 else "")} for j in range(60)]
    json.dump({"type": "excalidraw", "version": 2, "elements": els, "appState": {}, "files": {}}, open(os.path.join(d, f"d{i}.excalidraw"), "w"))
PY
echo "load: $(uptime | sed 's/.*load averages*: //')  drawings: $N  runs: $RUNS  bin: $(wc -c < "$BIN") bytes"
# time <prefix> <setup> <cmd...>: wall ms per run, p50/p95
measure() {
  prefix=$1; setup=$2; shift 2
  python3 -I - "$RUNS" "$prefix" "$setup" "$@" <<'PY'
import os, subprocess, sys, time, shlex
runs, prefix, setup, cmd = int(sys.argv[1]), sys.argv[2].split(), sys.argv[3], sys.argv[4:]
ts = []
for _ in range(runs):
    if setup: subprocess.run(setup, shell=True, check=True)
    t = time.perf_counter(); sin = os.environ.get('measure_stdin')
    r = subprocess.run(prefix + cmd, stdin=open(sin) if sin else None, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    ts.append((time.perf_counter() - t) * 1000)
    if r.returncode: sys.exit(r.stderr.decode())
ts.sort(); print("p50 %.1f ms  p95 %.1f ms  max %.1f ms" % (ts[len(ts)//2], ts[int(len(ts)*.95)-1], ts[-1]))
PY
}
# measure_in <prefix> <stdin file or ""> <setup> <cmd...>: like measure, with stdin from a file
measure_in() {
  p=$1; f=$2; shift 2
  if [ -n "$f" ]; then measure_stdin=$f measure "$p" "$@"; else measure "$p" "$@"; fi
}
for mode in normal background; do
  prefix=""; [ $mode = background ] && prefix="taskpolicy -c background"
  echo "== $mode"
  rm -rf "$VAULTDRAW_STATE_DIR"/*
  printf "ls            "; measure "$prefix" "" "$BIN" --vault "$V" ls --json
  printf "search cold   "; measure "$prefix" "rm -rf $VAULTDRAW_STATE_DIR/*" "$BIN" --vault "$V" search foo --json
  "$BIN" --vault "$V" search foo --json >/dev/null
  printf "search warm   "; measure "$prefix" "" "$BIN" --vault "$V" search foo --json
  SC=$T/scene.json; cp "$V/f0/d0.excalidraw" "$SC"
  printf "write         "; measure_in "$prefix" "$SC" "" "$BIN" --vault "$V" write f0/d0.excalidraw --json
  printf "new           "; measure_in "$prefix" "" "rm -f $V/f0/new.excalidraw" "$BIN" --vault "$V" new f0/new --json
done
