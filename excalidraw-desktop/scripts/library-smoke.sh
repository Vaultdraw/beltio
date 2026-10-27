#!/bin/sh
# Runs the packaged smoke app (built with --features smoke-test) once. At milestones
# (SMOKE_MILESTONE=1) it runs a second time against the same config + vault dirs to
# prove the library persists across a restart, then a third time under
# taskpolicy -c background (low-end), then scripts/watchdog-smoke.sh. Prints each report summary.
# Usage: [SMOKE_MILESTONE=1] scripts/library-smoke.sh   (run from anywhere; holds the shared build lock)
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
WT=$(cd "$HERE/.." && pwd)
# One lock shared by every worktree: it lives in the main checkout (parent of git common dir).
LOCK="$(dirname "$(git -C "$HERE" rev-parse --path-format=absolute --git-common-dir)")/.cache/build.lock"
APP="$HERE/src-tauri/target/release/bundle/macos/Vaultdraw.app/Contents/MacOS/excalidraw-vault"
T=$(date +%s); D="$WT/.cache/smoke-run-$T"; C="$WT/.cache/smoke-config-$T"
mkdir -p "$D" "$C/config/themes/Test Palette" "$C/state"
printf '{\n  "dark": { "mSurface": "#1b2b34", "mOnSurface": "#d8dee9", "mPrimary": "#ec5f67" }\n}\n' > "$C/config/themes/Test Palette/Test Palette.json"
echo "D=$D C=$C"
caffeinate -d -i -t 3600 & CAF=$!   # keep the display awake so requestAnimationFrame keeps firing
run() { # label, prefix...
  label=$1; shift
  rm -f "$D/smoke-report.json"
  # Each launch starts from a clean vault: earlier runs' drawings (smoke-exports/ui-edited,
  # smoke-suite-*, search/tags/links folders) match the suite's searches and lookups and
  # derail later steps. Only what the restart steps test is kept: the vault library
  # (config/state dirs are shared on purpose) and the per-run report copies.
  find "$D" -mindepth 1 -maxdepth 1 ! -name library.excalidrawlib ! -name 'smoke-report-*.json' -exec rm -rf {} +
  start=$(date +%s)
  # perl alarm: a hung WebView (rAF stops when the window is occluded) must not hold the lock forever.
  lockf -k "$LOCK" env EXCALIDRAW_VAULT_SMOKE_DIR="$D" VAULTDRAW_CONFIG_DIR="$C/config" VAULTDRAW_STATE_DIR="$C/state" "$@" perl -e 'alarm 900; exec {$ARGV[0]} @ARGV' "$APP"
  echo "== $label: exit=$? wall=$(( $(date +%s) - start ))s"
  cp "$D/smoke-report.json" "$D/smoke-report-$label.json" 2>/dev/null
  node -e '
const r=require(process.argv[1]);const a=r.details||r;
console.log("status",r.status,"elapsedMs",a.elapsedMs);
const all=r.steps||a.records||[];
for(const s of all){if(!s.ok||/^library/.test(s.step))console.log(s.ok?"ok  ":"FAIL",s.step,JSON.stringify(s.details).slice(0,400))}
const f=all.filter(s=>!s.ok);console.log("failed steps:",f.length,"pageErrors:",(a.pageErrors||[]).length)' "$D/smoke-report-$label.json"
}
run run1 env
if [ "${SMOKE_MILESTONE:-0}" = 1 ]; then
  run run2 env
  run run3-lowend taskpolicy -c background
  # Hang watchdog: dialog on a hung page, Cmd+Q quits (skips itself unless the Mac is idle).
  sh "$HERE/scripts/watchdog-smoke.sh"
fi
ls -la "$C/config/library.excalidrawlib" "$D/library.excalidrawlib"
kill $CAF 2>/dev/null
