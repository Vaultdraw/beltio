#!/bin/sh
# Packaged hang-watchdog check: hangs the page of the smoke app on purpose, waits for the
# watchdog dialog, presses Cmd+Q on it and checks that the app quits. Needs the packaged smoke
# app (built with --features smoke-test, like library-smoke.sh). A real dialog appears on screen
# for a few seconds, so it only runs when the keyboard and mouse have been idle for 5 minutes
# (WATCHDOG_SMOKE_FORCE=1 skips that check). Exit: 0 pass or skipped, 1 fail.
# Usage: scripts/watchdog-smoke.sh   (run from anywhere; holds the shared build lock)
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
WT=$(cd "$HERE/.." && pwd)
LOCK="$(dirname "$(git -C "$HERE" rev-parse --path-format=absolute --git-common-dir)")/.cache/build.lock"
APP="${WATCHDOG_SMOKE_APP:-$HERE/src-tauri/target/release/bundle/macos/Vaultdraw.app/Contents/MacOS/excalidraw-vault}"
[ -x "$APP" ] || { echo "watchdog-smoke: FAIL no app at $APP"; exit 1; }
idle=$(ioreg -c IOHIDSystem | awk '/HIDIdleTime/ {print int($NF/1000000000); exit}')
if [ "${WATCHDOG_SMOKE_FORCE:-0}" != 1 ] && [ "${idle:-0}" -lt 300 ]; then
  echo "watchdog-smoke: SKIPPED (keyboard/mouse idle ${idle:-0}s < 300s; a dialog would appear on screen)"
  exit 0
fi
T=$(date +%s); D="$WT/.cache/watchdog-smoke-$T"
mkdir -p "$D/vault" "$D/config" "$D/state"
printf '[watchdog]\nenabled = true\ngrace_ms = 1000\n' > "$D/config/config.toml"
OUT="$D/out.log"
echo "D=$D"
# perl alarm: whatever goes wrong, the app does not outlive 90 s. The frozen web process is
# continued by the trap, and by the app's own failure path.
lockf -k "$LOCK" env EXCALIDRAW_VAULT_SMOKE_DIR="$D/vault" VAULTDRAW_CONFIG_DIR="$D/config" VAULTDRAW_STATE_DIR="$D/state" \
  VAULTDRAW_WATCHDOG_SMOKE=1 VAULTDRAW_SMOKE_FOREGROUND=1 perl -e 'alarm 90; exec {$ARGV[0]} @ARGV' "$APP" > "$OUT" 2>&1 &
RUNNER=$!
cleanup() {
  pid=$(sed -n 's/^watchdog-smoke: web pid //p' "$OUT" 2>/dev/null | head -1)
  [ -n "$pid" ] && kill -CONT "$pid" 2>/dev/null
}
trap cleanup EXIT
wait "$RUNNER"; code=$?
cat "$OUT"
echo "== exit=$code"
fail=0
check() { # description, grep pattern
  if grep -q "$2" "$OUT"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi
}
check "page stopped" "watchdog-smoke: page stopped"
check "dialog appeared" "watchdog-smoke: dialog up after"
check "Cmd+Q sent" "watchdog-smoke: sent Cmd+Q"
if grep -q "watchdog-smoke: FAIL" "$OUT"; then echo "FAIL driver reported a failure"; fail=1; fi
[ "$code" = 0 ] && echo "ok   app exited with 0 after Cmd+Q" || { echo "FAIL app exit code $code (0 expected)"; fail=1; }
rec="$D/state/last-hang.json"
if grep -q '"choice":"quit"' "$rec" 2>/dev/null; then echo "ok   hang record says quit"; else echo "FAIL no quit record in $rec"; fail=1; fi
# No leftover process of this run (web content ends with the app).
pid=$(sed -n 's/^watchdog-smoke: web pid //p' "$OUT" | head -1)
if [ -n "$pid" ] && ps -p "$pid" >/dev/null 2>&1; then echo "FAIL web process $pid still alive"; kill -CONT "$pid"; fail=1; fi
if [ $fail = 0 ]; then echo "watchdog-smoke: PASS"; rm -rf "$D"; else echo "watchdog-smoke: FAILED (kept $D)"; fi
exit $fail
