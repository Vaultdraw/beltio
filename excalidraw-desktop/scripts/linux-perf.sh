#!/bin/sh
# Linux perf run in one command (inside the Linux machine or VM, from the repo root or anywhere):
#
#   sh excalidraw-desktop/scripts/linux-perf.sh [--low-end] [--compare <baseline.json>] [--update-baseline <baseline.json>]
#                                                [--build] [--out <result.json>] [--keep-runs] [--display :N] [-- <extra run.mjs args>]
#
# What it does, in order:
#   1. Builds the perf binary when it is missing or --build is given: `cargo build --release --features smoke-test
#      -p excalidraw-vault` (the same feature as the macOS perf app; the frontend `dist` must already be built with
#      VITE_APP_PERF_TEST=true and the CLI sidecar must sit in src-tauri/binaries/, see build.rs). The binary lands in
#      $CARGO_TARGET_DIR/release/excalidraw-vault (default src-tauri/target). PERF_APP_BIN points the run at another binary.
#   2. Starts Xvfb on a free display (or uses --display / $DISPLAY when one is already running) and generates the
#      fixture vaults if they are not cached (.cache/perf/fixtures).
#   3. Runs ONE measured app run: `node perf/run.mjs --app --skip-browser --no-build --quick [--low-end] ...`
#      (one run decides; no warmup, no repeat loops). --low-end = systemd-run --user --scope CPUQuota=25% MemoryHigh=1G
#      (PERF_LOWEND_CPU_QUOTA / PERF_LOWEND_MEMORY_HIGH override; nice + taskset when systemd-run is unavailable).
#   4. Stops the Xvfb it started, by PID. Exit code = run.mjs's (1 on a gate failure or a run error).
#
# Environment knobs: CARGO_TARGET_DIR, PERF_APP_BIN, PERF_APP_TIMEOUT_MS (per-run timeout on slow machines),
# PERF_LOWEND_CPU_QUOTA, PERF_LOWEND_MEMORY_HIGH, PERF_FIXTURES_DIR, CARGO_BUILD_JOBS (default 2), RUSTFLAGS.
# Chromium mode is skipped on Linux for now (it needs a Playwright Chromium install in the machine).
#
# Memory-limited machines (2 GiB): the release link needs lld and no debuginfo; the script sets
# CARGO_PROFILE_RELEASE_DEBUG=0 and adds `-C link-arg=-fuse-ld=lld` when lld is installed.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
desktop=$(cd "$here/.." && pwd)
root=$(cd "$desktop/.." && pwd)
tauri="$desktop/src-tauri"
target=${CARGO_TARGET_DIR:-$tauri/target}
bin=${PERF_APP_BIN:-$target/release/excalidraw-vault}
jobs=${CARGO_BUILD_JOBS:-2}

build=0
display=${DISPLAY:-}
args=""
while [ $# -gt 0 ]; do
  case "$1" in
    --build) build=1 ;;
    --display) display=$2; shift ;;
    --help|-h) sed -n '2,24p' "$0"; exit 0 ;;
    --) shift; args="$args $*"; break ;;
    *) args="$args $1" ;;
  esac
  shift
done

log() { echo "[linux-perf] $*" >&2; }

# 1. build
if [ "$build" = 1 ] || [ ! -x "$bin" ]; then
  if [ -n "${PERF_APP_BIN:-}" ] && [ ! -x "$bin" ]; then log "PERF_APP_BIN=$bin is not executable"; exit 2; fi
  [ -f "$desktop/dist/index.html" ] || { log "no frontend dist at $desktop/dist (build it with VITE_APP_PERF_TEST=true npx vite build, on a machine with enough memory)"; exit 2; }
  flags=${RUSTFLAGS:-}
  if command -v ld.lld >/dev/null 2>&1 || command -v lld >/dev/null 2>&1; then
    case "$flags" in *fuse-ld*) ;; *) flags="$flags -C link-arg=-fuse-ld=lld" ;; esac
  fi
  log "building $bin (cargo -j $jobs, release, smoke-test feature; log: $target/linux-perf-build.log)"
  mkdir -p "$target"
  (cd "$tauri" && CARGO_TARGET_DIR="$target" CARGO_PROFILE_RELEASE_DEBUG=0 RUSTFLAGS="$flags" \
    cargo build --release --features smoke-test -p excalidraw-vault -j "$jobs") >"$target/linux-perf-build.log" 2>&1 || {
    tail -30 "$target/linux-perf-build.log" >&2
    log "build failed (see the log). If the link ran out of memory, retry with CARGO_PROFILE_RELEASE_LTO=off CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16"
    exit 2
  }
  [ -x "$bin" ] || { log "build finished but $bin is missing"; exit 2; }
fi

# 2. display
xvfb_pid=""
if [ -z "$display" ]; then
  command -v Xvfb >/dev/null 2>&1 || { log "Xvfb is not installed and DISPLAY is unset"; exit 2; }
  n=90
  while [ $n -lt 200 ] && [ -e "/tmp/.X11-unix/X$n" ]; do n=$((n + 1)); done
  display=":$n"
  Xvfb "$display" -screen 0 1440x900x24 -nolisten tcp >/dev/null 2>&1 &
  xvfb_pid=$!
  # bounded wait for the socket
  i=0
  while [ $i -lt 50 ] && [ ! -e "/tmp/.X11-unix/X$n" ]; do i=$((i + 1)); sleep 0.1; done
  [ -e "/tmp/.X11-unix/X$n" ] || { log "Xvfb did not come up on $display"; kill "$xvfb_pid" 2>/dev/null || true; exit 2; }
  log "Xvfb on $display (pid $xvfb_pid)"
fi
cleanup() { if [ -n "$xvfb_pid" ]; then kill "$xvfb_pid" 2>/dev/null || true; fi; }
trap cleanup EXIT INT TERM

# 3. run (one measured run)
export DISPLAY="$display" PERF_APP_BIN="$bin"
log "node perf/run.mjs --app --skip-browser --no-build --quick$args"
set +e
(cd "$root" && node excalidraw-desktop/perf/run.mjs --app --skip-browser --no-build --quick $args)
code=$?
set -e
exit $code
