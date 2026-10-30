#!/bin/sh
# Packaged control check (macOS): the smoke-test app launched by hand, driven only through the `vaultdraw` CLI
# and real file-system changes. Hunter C, 2026-10-30. Needs the app built with the smoke feature:
#   VITE_APP_SMOKE_TEST=true node ../node_modules/@tauri-apps/cli/tauri.js build --features smoke-test --bundles app --config src-tauri/tauri.test.conf.json
# Usage: scripts/packaged-control-check.sh   (opens one app window; check HID idle > 300 s first; never runs while a perf run holds the build lock)
# Prints PASS/FAIL per check; "CLAIM" checks were the open hunter claims (C-8 to C-11, all fixed on 2026-10-30); a claim that fails again is a regression.
# Exit 1 on any FAIL that is not a CLAIM; CLAIM_STRICT=1 makes claims fail the run too.
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
BIN=${VAULTDRAW_APP_DIR:-$HERE/src-tauri/target/release/bundle/macos/Vaultdraw.app/Contents/MacOS}
APP="$BIN/excalidraw-vault"; CLI="$BIN/vaultdraw"
[ -x "$APP" ] && [ -x "$CLI" ] || { echo "FAIL app or cli missing in $BIN"; exit 1; }
T=$(mktemp -d /tmp/vdcc.XXXXXX); V="$T/v"; V2="$T/v2"
mkdir -p "$T/cfg" "$T/st" "$T/rt" "$V/Sub" "$V2"; chmod 700 "$T/rt"
export VAULTDRAW_CONFIG_DIR="$T/cfg" VAULTDRAW_STATE_DIR="$T/st" VAULTDRAW_RUNTIME_DIR="$T/rt" VAULTDRAW_VAULT="$V"
FAILS=0; CLAIMS=0
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; FAILS=$((FAILS+1)); }
claim() { echo "CLAIM-FAIL $1"; CLAIMS=$((CLAIMS+1)); }
v() { "$CLI" "$@"; }
scene() { # text... -> one text element per argument
  node -e 'const t=process.argv.slice(1);console.log(JSON.stringify({type:"excalidraw",version:2,source:"cc",elements:t.map((x,i)=>({id:"t"+i,type:"text",x:10,y:10+i*40,width:200,height:25,angle:0,strokeColor:"#1e1e1e",backgroundColor:"transparent",fillStyle:"solid",strokeWidth:2,strokeStyle:"solid",roughness:1,opacity:100,groupIds:[],frameId:null,roundness:null,seed:i+1,version:1,versionNonce:i+1,isDeleted:false,boundElements:null,updated:1,link:null,locked:false,text:x,fontSize:20,fontFamily:5,textAlign:"left",verticalAlign:"top",baseline:18,containerId:null,originalText:x,lineHeight:1.25,autoResize:true})),appState:{viewBackgroundColor:"#ffffff"},files:{}}))' "$@"
}
# wait_for <seconds> <command...>: true as soon as the command succeeds (bounded)
wait_for() { n=$(( $1 * 4 )); shift; i=0; while [ $i -lt $n ]; do "$@" >/dev/null 2>&1 && return 0; i=$((i+1)); sleep 0.25; done; return 1; }
cleanup() { [ -n "${APID:-}" ] && ps -p "$APID" >/dev/null 2>&1 && kill "$APID" 2>/dev/null; sleep 1; rm -rf "$T"; }
trap cleanup EXIT

scene "Alpha hub" "[[Beta]]" "#alphatag" > "$V/Alpha.excalidraw"
scene "Beta page" "back [[Alpha]]" "#betatag" > "$V/Beta.excalidraw"
scene "Gamma" "[[Alpha]]" "#gammatag" > "$V/Sub/Gamma.excalidraw"
scene "Other" "#o2" > "$V2/Other.excalidraw"
caffeinate -d -i -t 600 & CAF=$!
"$APP" >"$T/app.log" 2>&1 & APID=$!
wait_for 40 v status && wait_for 30 v ls && pass "app up, vault open, control socket answers" || { fail "app did not come up"; tail -5 "$T/app.log"; kill $CAF; exit 1; }

# 1. reads
v cat Alpha >/dev/null 2>&1 && pass "CLAIM C-10 a bare name resolves as soon as ls answers" || claim "C-10: 'cat Alpha' right after the vault opens: No drawing matches (name index not ready)"
wait_for 15 v cat Alpha || fail "bare name Alpha never resolves"
v ls | grep -q '^Alpha.excalidraw$' && pass "ls lists the vault" || fail "ls"
BL='[ "$(v links Alpha --backlinks 2>/dev/null | sort | tr "\n" " ")" = "Beta.excalidraw Sub/Gamma.excalidraw " ]'
eval "$BL" && pass "CLAIM C-10 backlinks are complete as soon as the vault answers" || claim "C-10: backlinks of Alpha right after the vault opens: '$(v links Alpha --backlinks 2>&1 | tr '\n' ' ')' (link index not ready)"
wait_for 15 sh -c "$(printf '%s' "$BL" | sed "s#v links#'$CLI' links#")" && pass "backlinks of Alpha (after the index settles)" || fail "backlinks of Alpha never complete"

# 2. outside edit and delete: index follows (backlinks, tags, listing)
rm "$V/Beta.excalidraw"
wait_for 5 sh -c "! '$CLI' tags | grep -q betatag" && pass "outside delete: its tag leaves the tags list" || fail "outside delete: betatag still listed"
[ "$(v links Alpha --backlinks | tr '\n' ' ')" = "Sub/Gamma.excalidraw " ] && pass "outside delete: backlink gone" || fail "outside delete: backlinks $(v links Alpha --backlinks | tr '\n' ' ')"
scene "Gamma" "no link now" "#gammatag2" > "$V/Sub/Gamma.excalidraw"
wait_for 5 sh -c "'$CLI' tags | grep -q gammatag2" && pass "outside edit: new tag appears" || fail "outside edit: gammatag2 missing"
[ -z "$(v links Alpha --backlinks)" ] && pass "outside edit: backlink removed" || fail "outside edit: backlinks still $(v links Alpha --backlinks | tr '\n' ' ')"

# 3. auto reload off: the listing stays, Refresh catches up, on again follows
v config set files.auto_reload false >/dev/null; sleep 2
scene "Eta #eta" > "$V/Eta.excalidraw"; sleep 3
v tags | grep -q '^eta' && fail "auto reload off: tag eta appeared without a refresh" || pass "auto reload off: no live update"
v cmd run navigator.refresh >/dev/null; wait_for 5 sh -c "'$CLI' tags | grep -q '^eta'" && pass "Refresh catches up" || fail "Refresh did not pick up Eta"
v config set files.auto_reload true >/dev/null; sleep 2
rm "$V/Eta.excalidraw"; wait_for 5 sh -c "! '$CLI' tags | grep -q '^eta'" && pass "auto reload on again: live" || fail "auto reload on: eta still listed"

# 4. open, scene read and write
v open Alpha >/dev/null && pass "open by name" || fail "open Alpha"
v scene read >/dev/null 2>&1 && pass "CLAIM C-10 scene read works right after open" || claim "C-10: 'open Alpha' then 'scene read' at once: No drawing is open (editor not mounted yet)"
wait_for 10 v scene read || fail "scene read never works after open"
echo '[{"op":"add","element":{"type":"rectangle","x":300,"y":300,"width":50,"height":50}}]' | v scene apply >/dev/null && v scene read | grep -q rectangle && pass "scene apply then read" || fail "scene apply/read"
wait_for 6 sh -c "grep -q rectangle '$V/Alpha.excalidraw'" && pass "scene edit saved to disk" || fail "scene edit not saved"

# 5. plugin run and call
sleep 8
v plugin methods 2>&1 | grep -q mermaid.to_drawing && pass "CLAIM C-11 official plugin methods are listed on a fresh config" || claim "C-11: fresh config: 'plugin methods' / 'plugin commands' list no plugin (official mermaid, favourites... are on by default and in the palette); 'plugin call mermaid' = No method"
if ! v plugin methods 2>&1 | grep -q mermaid.to_drawing; then # work around: enabling one user plugin starts the host
  mkdir -p "$T/cfg/plugins"; cp -R "$HERE/../sdk/examples/hello-command" "$T/cfg/plugins/"; v config set plugins.enabled '["hello-command"]' >/dev/null 2>&1
fi
wait_for 20 sh -c "'$CLI' plugin methods | grep -q mermaid.to_drawing" || fail "plugin method never registered"
v plugin call mermaid to_drawing '{"text":"graph TD\nA --> B","path":"Diag.excalidraw"}' >/dev/null 2>"$T/plugin.err" && [ -f "$V/Diag.excalidraw" ] && pass "plugin call mermaid.to_drawing creates a drawing" || fail "plugin call mermaid.to_drawing: $(cat "$T/plugin.err")"
v plugin call mermaid to_drawing '{"text":"graph TD\nA --> B","path":"../x.excalidraw"}' >/dev/null 2>&1 && fail "plugin path with .. accepted" || pass "plugin path with .. refused"
[ ! -e "$T/x.excalidraw" ] && pass "nothing written outside the vault" || fail "file escaped the vault"

# 6. hunter claims
v new Fresh >/dev/null; v open Fresh >/dev/null 2>&1 && pass "CLAIM C-10 new then open by bare name works at once" || claim "C-10: 'new Fresh' then 'open Fresh' at once: No drawing matches (index lags ~0.8 s)"
v new MvA >/dev/null; sleep 2; v mv MvA MvB >/dev/null 2>&1; sleep 1
[ -e "$V/MvB.excalidraw" ] && pass "CLAIM C-8 mv without extension keeps .excalidraw" || claim "C-8: 'mv MvA MvB' leaves a file named MvB with no extension (gone from ls, search, open)"
v config set files.auto_reload banana >/dev/null 2>&1 && claim "C-9: 'config set files.auto_reload banana' accepted (exit 0)" || pass "CLAIM C-9 config set refuses a wrong type"
v config set files.auto_reload true >/dev/null 2>&1
v config set files.auto_reloadd false >/dev/null 2>&1 && claim "C-9: 'config set files.auto_reloadd false' (misspelt key) accepted" || pass "CLAIM C-9 config set refuses an unknown key"

# 6b. small items fixed after hunter C round 3
v plugin call mermaid to_drawing '{"text":"graph TD\nA --> B","path":"NewDir/Sub/D2.excalidraw"}' >/dev/null 2>&1 && [ -f "$V/NewDir/Sub/D2.excalidraw" ] && pass "plugin call into a missing folder creates the folder" || fail "plugin call into a missing folder"
v open Fresh >/dev/null 2>&1; v tab close Fresh >/dev/null 2>&1 && ! v tabs | grep -q Fresh && pass "tab close by bare name" || fail "tab close Fresh (bare name)"
v open Alpha >/dev/null 2>&1; v open Fresh --new-tab >/dev/null 2>&1; v tab close 2 >/dev/null 2>&1 && ! v tabs | grep -q Fresh && pass "tab close by number" || fail "tab close 2 (number)"

# 7. vault switch
v vault open "$V2" >/dev/null; sleep 2
[ "$(v ls | tr '\n' ' ')" = "Other.excalidraw " ] && pass "vault switch: listing is the new vault's" || fail "vault switch listing: $(v ls | tr '\n' ' ')"
v search Alpha | grep -q . && fail "vault switch: search still finds the old vault's drawing" || pass "vault switch: search is the new vault's"
v tags | grep -q alphatag && fail "vault switch: old tags remain" || pass "vault switch: tags are the new vault's"
v vault open "$V" >/dev/null; sleep 2; v ls | grep -q '^Alpha.excalidraw$' && pass "switch back" || fail "switch back"

# 8. quit
v quit >/dev/null 2>&1; wait_for 15 sh -c "! ps -p $APID >/dev/null" && pass "quit ends the app" || { fail "quit left the app running"; kill "$APID" 2>/dev/null; }
kill $CAF 2>/dev/null
echo "failures: $FAILS, open claims: $CLAIMS"
[ "$FAILS" = 0 ] && { [ "${CLAIM_STRICT:-0}" = 1 ] && [ "$CLAIMS" != 0 ] && exit 1; exit 0; }
exit 1
