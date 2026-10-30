#!/bin/sh
# Linux user-experience check on an INSTALLED Vaultdraw (/usr/bin), headless: Xvfb, a window manager and the real X clipboard.
#   1. the webview reports a Linux platform (the file-manager command is named for Linux, not Finder)
#   2. shortcut labels show Ctrl, not Cmd (a screenshot of the palette is saved to $OUT/palette.png)
#   3. "Reveal in file manager" runs dbus-send ShowItems, and xdg-open on the folder when that fails (PATH shims log the commands)
#   4. a window-manager close right after an unsaved edit still saves it (the quit barrier)
#   5. copy and paste through the real clipboard (xclip reads what Ctrl+C put there; Ctrl+V pastes it in another drawing)
# Needs: Xvfb openbox wmctrl xdotool xclip imagemagick dbus-run-session. Prints PASS/FAIL; exit 1 on any FAIL.
set -u
APP=/usr/bin/excalidraw-vault; CLI=/usr/bin/vaultdraw
OUT=${OUT:-/tmp/vdux-out}; T=$(mktemp -d /tmp/vdux.XXXXXX); mkdir -p "$OUT"
FAILS=0
pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; FAILS=$((FAILS + 1)); }
mkdir -p $T/home $T/cfg/app.vaultdraw $T/state $T/rt $T/vault $T/shim; chmod 700 $T/rt
SC='{"type":"excalidraw","version":2,"source":"x","elements":[{"id":"r1","type":"rectangle","x":10,"y":10,"width":120,"height":60,"angle":0,"strokeColor":"#1e1e1e","backgroundColor":"transparent","fillStyle":"solid","strokeWidth":2,"strokeStyle":"solid","roughness":1,"opacity":100,"groupIds":[],"frameId":null,"roundness":null,"seed":1,"version":1,"versionNonce":1,"isDeleted":false,"boundElements":null,"updated":1,"link":null,"locked":false}],"appState":{"viewBackgroundColor":"#ffffff"},"files":{}}'
echo "$SC" > $T/vault/Alpha.excalidraw; printf '%s' $T/vault > $T/cfg/app.vaultdraw/recent-vault
for c in xdg-open dbus-send; do printf '#!/bin/sh\necho "%s $*" >> %s/shim.log\n[ -f %s/fail-%s ] && exit 1\nexit 0\n' $c $T $T $c > $T/shim/$c; chmod +x $T/shim/$c; done
D=:$((200 + $$ % 50))
Xvfb $D -screen 0 1440x900x24 >$T/xvfb.log 2>&1 & XP=$!
sleep 2
export HOME=$T/home XDG_CONFIG_HOME=$T/cfg XDG_STATE_HOME=$T/state XDG_RUNTIME_DIR=$T/rt DISPLAY=$D
openbox >$T/ob.log 2>&1 & OP=$!
PATH=$T/shim:$PATH dbus-run-session -- $APP >$T/app.log 2>&1 &
i=0; while [ $i -lt 90 ]; do $CLI --json status 2>/dev/null | grep -q '"windowReady": *true' && break; i=$((i+1)); sleep 1; done
cleanup() { kill $OP $XP 2>/dev/null; $CLI quit >/dev/null 2>&1; sleep 1; pkill -u "$(id -u)" -f "$T" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT
$CLI --json status 2>/dev/null | grep -q '"windowReady": *true' && pass "app started, window ready" || { fail "app did not start"; tail -5 $T/app.log; exit 1; }
$CLI open Alpha.excalidraw >/dev/null; sleep 2

# 2. labels and 1. Linux platform wording
$CLI cmd run palette.commands >/dev/null; sleep 2; xdotool type "open link under"; sleep 1; import -window root "$OUT/palette.png"
$CLI cmd list | grep -q 'Mod+Shift+P' && pass "command list is available" || fail "command list"
$CLI --json cmd list | grep -q '"title": *"Reveal drawing in file manager"' && pass "platform is Linux: the reveal command says file manager, not Finder" || fail "reveal command still says Finder (navigator.platform is not Linux?)"
xdotool key Escape; sleep 1
echo "(look at $OUT/palette.png: shortcut chips must read Ctrl, never Cmd)"

# 3. reveal
$CLI cmd run file.revealInFinder >/dev/null; sleep 2
grep -q 'dbus-send.*FileManager1.*ShowItems.*Alpha.excalidraw' $T/shim.log && pass "reveal: dbus-send FileManager1.ShowItems with the drawing" || fail "reveal: no ShowItems call ($(cat $T/shim.log 2>/dev/null))"
touch $T/fail-dbus-send; $CLI cmd run file.revealInFinder >/dev/null; sleep 3
grep -q "xdg-open $T/vault" $T/shim.log && pass "reveal: falls back to xdg-open on the folder when the file manager service is missing" || fail "reveal fallback: $(tail -2 $T/shim.log)"

# 5. clipboard
xdotool mousemove 500 500 click 1; sleep 1; xdotool key ctrl+a; sleep 1; xdotool key ctrl+c; sleep 2
xclip -selection clipboard -o 2>/dev/null | grep -q '"type":"excalidraw/clipboard"' && pass "copy: the real X clipboard holds the drawing (excalidraw/clipboard JSON)" || fail "copy: clipboard empty or not a drawing"
$CLI new Gamma >/dev/null; sleep 2; xdotool mousemove 500 500 click 1; sleep 1; xdotool key ctrl+v; sleep 2
$CLI scene read 2>/dev/null | grep -q rectangle && pass "paste: Ctrl+V put the copied rectangle into another drawing" || fail "paste: nothing pasted"

# 4. close with an unsaved edit
$CLI open Alpha.excalidraw >/dev/null; sleep 2
echo '[{"op":"add","element":{"type":"ellipse","x":300,"y":300,"width":50,"height":50}}]' | $CLI scene apply >/dev/null 2>&1
wmctrl -c Vaultdraw
i=0; while [ $i -lt 15 ]; do pgrep -u "$(id -u)" -f "$APP" >/dev/null || break; i=$((i+1)); sleep 1; done
pgrep -u "$(id -u)" -f "$APP" >/dev/null && fail "window close: the app is still running" || pass "window close: the app quit"
grep -q ellipse $T/vault/Alpha.excalidraw && pass "window close: the edit made just before it is on disk (quit barrier ran)" || fail "window close: the edit was lost"
echo "RESULT: $FAILS failure(s)"; [ $FAILS = 0 ]
