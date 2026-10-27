#!/bin/sh
# Linux control check: the control socket, the `vaultdraw` command line tool and MCP, end to end.
#
# Starts Xvfb and the app with an isolated HOME, XDG folders and a small generated vault, then
# checks the socket folder and file modes, runs the CLI against the app (status, ls, cat, export,
# MCP handshake), stops the app with SIGTERM, checks the socket is gone, and runs one headless
# read with the app closed. Every step prints PASS or FAIL; the exit code is 1 on any FAIL.
#
# Environment:
#   VAULTDRAW_APP_BIN  app binary   (default: target/release/excalidraw-vault next to src-tauri)
#   VAULTDRAW_CLI_BIN  CLI binary   (default: `vaultdraw` next to the app, else `vaultdraw-cli`)
#   CHECK_READY_SECS   wait for the window (default 90)
# Needs: Xvfb. Uses dbus-run-session when installed. Never touches real user folders.
set -u

HERE=$(cd "$(dirname "$0")/.." && pwd)
APP=${VAULTDRAW_APP_BIN:-$HERE/src-tauri/target/release/excalidraw-vault}
READY_SECS=${CHECK_READY_SECS:-90}
FAILS=0
XPID=""
APID=""
TMP=""

pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; FAILS=$((FAILS + 1)); }
check() { # label, command...  (PASS when the command succeeds)
  label=$1; shift
  if "$@" >/dev/null 2>&1; then pass "$label"; else fail "$label"; fi
}

alive() { [ -n "$1" ] && ps -p "$1" >/dev/null 2>&1; }

cleanup() {
  # Only our own processes, by PID.
  for p in "$APID" "$XPID"; do
    if alive "$p"; then kill "$p" 2>/dev/null; fi
  done
  i=0
  while [ $i -lt 30 ]; do
    if ! alive "$APID" && ! alive "$XPID"; then break; fi
    i=$((i + 1)); sleep 0.2
  done
  for p in "$APID" "$XPID"; do
    if alive "$p"; then kill -9 "$p" 2>/dev/null; fi
  done
  if [ -n "$TMP" ] && [ -d "$TMP" ]; then rm -rf "$TMP"; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# --- tools and binaries -------------------------------------------------------------------
[ -x "$APP" ] || { fail "app binary not found or not executable: $APP (set VAULTDRAW_APP_BIN)"; exit 1; }
command -v Xvfb >/dev/null 2>&1 || { fail "Xvfb is not installed"; exit 1; }
CLI=${VAULTDRAW_CLI_BIN:-}
if [ -z "$CLI" ]; then
  d=$(dirname "$APP")
  for c in "$d/vaultdraw" "$d/vaultdraw-cli"; do
    if [ -x "$c" ] && "$c" --version >/dev/null 2>&1; then CLI=$c; break; fi
  done
fi
[ -n "$CLI" ] && "$CLI" --version >/dev/null 2>&1 || { fail "CLI binary not found or not working (set VAULTDRAW_CLI_BIN)"; exit 1; }
pass "binaries: app=$APP cli=$CLI ($("$CLI" --version 2>&1 | head -n 1))"

# --- isolated environment -----------------------------------------------------------------
TMP=$(mktemp -d "${TMPDIR:-/tmp}/vdcheck.XXXXXX") || { fail "cannot create a temp folder"; exit 1; }
mkdir -p "$TMP/home" "$TMP/cfg" "$TMP/state" "$TMP/rt" "$TMP/vault/Graphs"
chmod 700 "$TMP/rt"
SCENE='{"type":"excalidraw","version":2,"source":"linux-control-check","elements":[{"id":"r1","type":"rectangle","x":10,"y":10,"width":120,"height":60,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"transparent","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"roundness":null,"seed":1,"version":1,"versionNonce":1,"isDeleted":false,"boundElements":null,"updated":1,"link":null,"locked":false}],"appState":{"viewBackgroundColor":"#ffffff"},"files":{}}'
printf '%s\n' "$SCENE" > "$TMP/vault/Alpha.excalidraw"
printf '%s\n' "$SCENE" > "$TMP/vault/Graphs/Beta.excalidraw"
# The app reopens its last vault: write that file where the app reads it (its config folder).
mkdir -p "$TMP/cfg/app.vaultdraw"
printf '%s' "$TMP/vault" > "$TMP/cfg/app.vaultdraw/recent-vault"
RT="$TMP/rt/vaultdraw"
SOCK="$RT/ctl.sock"

# Both the app and the CLI see the same environment.
appenv() {
  env HOME="$TMP/home" XDG_CONFIG_HOME="$TMP/cfg" XDG_STATE_HOME="$TMP/state" XDG_RUNTIME_DIR="$TMP/rt" \
    DISPLAY=":$DISP" "$@"
}
cli() {
  env HOME="$TMP/home" XDG_CONFIG_HOME="$TMP/cfg" XDG_STATE_HOME="$TMP/state" XDG_RUNTIME_DIR="$TMP/rt" \
    "$CLI" "$@"
}

# --- Xvfb on a free display ---------------------------------------------------------------
DISP=""
n=90
while [ $n -lt 140 ]; do
  if [ ! -e "/tmp/.X11-unix/X$n" ] && [ ! -e "/tmp/.X$n-lock" ]; then
    Xvfb ":$n" -screen 0 1440x900x24 >"$TMP/xvfb.log" 2>&1 &
    XPID=$!
    sleep 1
    if alive "$XPID"; then DISP=$n; break; fi
    XPID=""
  fi
  n=$((n + 1))
done
if [ -z "$DISP" ]; then fail "Xvfb: no free display"; exit 1; fi
pass "Xvfb on :$DISP"

# --- start the app ------------------------------------------------------------------------
OLDPID=""
start_app() { # label
  if command -v dbus-run-session >/dev/null 2>&1; then
    appenv dbus-run-session -- "$APP" >"$TMP/app-$1.log" 2>&1 &
  else
    appenv "$APP" >"$TMP/app-$1.log" 2>&1 &
  fi
  LAUNCHER=$!
  i=0
  while [ $i -lt 150 ]; do
    [ -S "$SOCK" ] && cli --json status >/dev/null 2>&1 && break
    if ! alive "$LAUNCHER"; then break; fi
    i=$((i + 1)); sleep 0.2
  done
  if [ -S "$SOCK" ] && cli --json status >/dev/null 2>&1; then pass "$1: control socket answers at $SOCK"; else
    fail "$1: control socket did not come up"; tail -n 20 "$TMP/app-$1.log"; return 1
  fi
  # The app's own PID (the launcher may be dbus-run-session); skip a stale file of the last run.
  APID=""; i=0
  while [ $i -lt 50 ]; do
    p=$(sed -n 's/.*"pid"[: ]*\([0-9][0-9]*\).*/\1/p' "$RT/instance.json" 2>/dev/null | head -n 1)
    if [ -n "$p" ] && [ "$p" != "$OLDPID" ] && alive "$p"; then APID=$p; break; fi
    i=$((i + 1)); sleep 0.2
  done
  if [ -n "$APID" ]; then pass "$1: instance.json names the live app pid ($APID)"; else fail "$1: instance.json has no live pid"; APID=$LAUNCHER; fi
  OLDPID=$APID
  return 0
}

wait_ready() {
  i=0
  while [ $i -lt "$READY_SECS" ]; do
    if cli --json status 2>/dev/null | grep -q '"windowReady": *true'; then return 0; fi
    i=$((i + 1)); sleep 1
  done
  return 1
}

wait_gone() { # pid  (bounded)
  i=0
  while [ $i -lt 100 ]; do
    alive "$1" || return 0
    i=$((i + 1)); sleep 0.2
  done
  return 1
}

start_app first || exit 1

# --- modes --------------------------------------------------------------------------------
mode() { stat -c '%a' "$1" 2>/dev/null; }
[ "$(mode "$RT")" = 700 ] && pass "runtime folder mode 700" || fail "runtime folder mode is $(mode "$RT"), want 700"
[ "$(mode "$SOCK")" = 600 ] && pass "socket mode 600" || fail "socket mode is $(mode "$SOCK"), want 600"
[ "$(stat -c '%u' "$SOCK" 2>/dev/null)" = "$(id -u)" ] && pass "socket owned by this user" || fail "socket owner differs"
n=${#SOCK}
[ "$n" -le 103 ] && pass "socket path is $n bytes (limit 103)" || fail "socket path is $n bytes"

# --- wait for the window, then use the CLI ------------------------------------------------
if wait_ready; then pass "status: app answers and the window is ready"; else fail "status: window not ready after ${READY_SECS}s"; cli --json status 2>&1 | head -n 5; fi

out=$(cli --json status 2>&1)
case $out in *"$TMP/vault"*) pass "status names the vault";; *) fail "status does not name the vault: $out";; esac
check "version" cli version
out=$(cli ls 2>&1); case $out in *Alpha*Graphs*|*Graphs*Alpha*|*Alpha*Beta*) pass "ls lists the vault drawings";; *) fail "ls output: $out";; esac
out=$(cli --json vault 2>&1); case $out in *"$TMP/vault"*) pass "vault info";; *) fail "vault info: $out";; esac
out=$(cli cat Alpha.excalidraw 2>&1); case $out in *rectangle*) pass "cat Alpha returns the scene";; *) fail "cat Alpha: $out";; esac
cli export Alpha.excalidraw -o "$TMP/alpha.svg" >"$TMP/export.log" 2>&1
if [ -s "$TMP/alpha.svg" ] && grep -q '<svg' "$TMP/alpha.svg"; then pass "export SVG"; else fail "export SVG: $(cat "$TMP/export.log")"; fi
cli export Alpha.excalidraw -o "$TMP/alpha.png" >"$TMP/export.log" 2>&1
if [ -s "$TMP/alpha.png" ] && [ "$(head -c 4 "$TMP/alpha.png" | tail -c 3)" = PNG ]; then pass "export PNG"; else fail "export PNG: $(cat "$TMP/export.log")"; fi
check "doctor" cli doctor
out=$(cli --offline ls 2>&1); rc=$?
[ $rc -eq 2 ] && pass "offline read is refused while the app runs (exit 2)" || fail "offline read with a live app: exit $rc: $out"

# --- MCP handshake over stdio -------------------------------------------------------------
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"linux-control-check","version":"0"}}}'
out=$(printf '%s\n' "$INIT" | cli mcp 2>&1)
case $out in *'"protocolVersion"'*) pass "MCP initialize";; *) fail "MCP initialize: $out";; esac

# --- peer check: another user cannot reach the socket (needs passwordless sudo) ------------
if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1 && id nobody >/dev/null 2>&1; then
  if sudo -n -u nobody "$CLI" --socket "$SOCK" status >/dev/null 2>&1; then fail "another user could use the socket"; else pass "another user is refused (folder 0700, socket 0600)"; fi
else
  printf 'SKIP another-user check (no passwordless sudo)\n'
fi

# --- SIGTERM (kill, logout, service stop): the app ends and a stale socket is harmless ------
kill -TERM "$APID" 2>/dev/null
if wait_gone "$APID"; then pass "app exited on SIGTERM"; else fail "app still running after SIGTERM"; fi
if [ -e "$SOCK" ]; then printf 'INFO the app left a stale socket after SIGTERM (only a graceful quit removes it)\n'; fi
out=$(cli status 2>&1); rc=$?
[ $rc -eq 3 ] && pass "status after SIGTERM: not running (exit 3), the stale socket is ignored" || fail "status after SIGTERM: exit $rc: $out"

# --- start again over the stale socket, then a graceful quit removes the files --------------
if start_app second; then
  if wait_ready; then pass "second: window ready"; else fail "second: window not ready"; fi
  cli quit >"$TMP/quit.log" 2>&1
  if wait_gone "$APID"; then pass "vaultdraw quit: app exited"; else fail "vaultdraw quit: app still running: $(cat "$TMP/quit.log")"; fi
  [ ! -e "$SOCK" ] && pass "socket file removed after a graceful quit" || fail "socket file left behind after a graceful quit"
  [ ! -e "$RT/instance.json" ] && pass "instance.json removed after a graceful quit" || fail "instance.json left behind"
fi

# --- headless read with the app closed ----------------------------------------------------
out=$(cli --vault "$TMP/vault" ls 2>&1); rc=$?
case $out in *Alpha*) [ $rc -eq 0 ] && pass "headless ls with no app" || fail "headless ls exit $rc";; *) fail "headless ls: $out";; esac
out=$(cli --vault "$TMP/vault" cat Alpha.excalidraw 2>&1)
case $out in *rectangle*) pass "headless cat with no app";; *) fail "headless cat: $out";; esac

echo
if [ $FAILS -eq 0 ]; then echo "linux-control-check: all steps passed"; exit 0; fi
echo "linux-control-check: $FAILS step(s) failed"
exit 1
