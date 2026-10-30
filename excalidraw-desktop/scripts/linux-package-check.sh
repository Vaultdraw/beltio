#!/bin/sh
# Linux package check: install a Vaultdraw .deb or .rpm (or an Arch package built from the PKGBUILD),
# check the install, start the app under Xvfb with linux-control-check.sh, uninstall, check nothing is left.
#
# Usage (as a normal user with sudo, on the target distro):  linux-package-check.sh <package-file>
# Packages: *.deb (apt), *.rpm (dnf), *.pkg.tar.* (pacman -U). Prints PASS or FAIL per step; exit 1 on any FAIL.
set -u
PKG=${1:?usage: linux-package-check.sh <package file>}
HERE=$(cd "$(dirname "$0")" && pwd)
FAILS=0
pass() { printf 'PASS %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; FAILS=$((FAILS + 1)); }
check() { label=$1; shift; if "$@" >/dev/null 2>&1; then pass "$label"; else fail "$label"; fi; }

case "$PKG" in
  *.deb) INSTALL="sudo apt-get install -y $PKG"; REMOVE="sudo apt-get remove -y vaultdraw"
         TOOLS="sudo apt-get install -y xvfb dbus-x11 desktop-file-utils xdg-utils shared-mime-info" ;;
  *.rpm) # DNF_OPTS="--setopt=tsflags=noscripts" skips the other packages' scriptlets: on an emulated (Rosetta) x86_64 Fedora their systemd-tmpfiles calls hang.
         # Cisco's openh264 mirror is sometimes unreachable; the retry leaves it out (WebKitGTK plays H.264 through it only when it is present).
         INSTALL="sudo dnf install -y ${DNF_OPTS:-} $PKG || sudo dnf install -y ${DNF_OPTS:-} --exclude=openh264 $PKG"; REMOVE="sudo dnf remove -y vaultdraw"
         TOOLS="sudo dnf install -y ${DNF_OPTS:-} xorg-x11-server-Xvfb dbus-x11 desktop-file-utils xdg-utils shared-mime-info" ;;
  *.pkg.tar.*) INSTALL="sudo pacman -U --noconfirm $PKG"; REMOVE="sudo pacman -Rns --noconfirm vaultdraw-bin"
         TOOLS="sudo pacman -S --needed --noconfirm xorg-server-xvfb dbus desktop-file-utils xdg-utils shared-mime-info" ;;
  *) echo "unknown package type: $PKG" >&2; exit 2 ;;
esac

echo "== tools"; $TOOLS >/dev/null 2>&1 || echo "(tools install reported an error; continuing)"
echo "== install"; if sh -c "$INSTALL" >/tmp/vd-install.log 2>&1; then pass "install"; else fail "install (see /tmp/vd-install.log)"; tail -15 /tmp/vd-install.log; fi

echo "== files"
check "vaultdraw is on PATH" command -v vaultdraw
check "vaultdraw --version prints a version" sh -c 'vaultdraw --version | grep -Eq "[0-9]+\.[0-9]+\.[0-9]+"'
check "app binary installed" test -x /usr/bin/excalidraw-vault
DESK=$(ls /usr/share/applications/*aultdraw*.desktop 2>/dev/null | head -1)
check "desktop file exists" test -n "$DESK"
check "desktop-file-validate passes" desktop-file-validate "$DESK"
check "desktop Exec resolves" sh -c "command -v \$(sed -n 's/^Exec=\\([^ ]*\\).*/\\1/p' '$DESK' | head -1)"
ICON=$(sed -n 's/^Icon=//p' "$DESK" | head -1)
check "icon $ICON installed (hicolor)" sh -c "ls /usr/share/icons/hicolor/*/apps/$ICON.png"
check "icon sizes 32,128,256,512" sh -c "for s in 32x32 128x128 256x256 512x512; do test -f /usr/share/icons/hicolor/\$s/apps/$ICON.png || exit 1; done"
check "MIME file installed" test -f /usr/share/mime/packages/vaultdraw.xml
sudo update-mime-database /usr/share/mime >/dev/null 2>&1
T=$(mktemp -d); echo '{"type":"excalidraw"}' > "$T/a.excalidraw"
# The MIME database (what file managers read) must map the extension. xdg-mime alone can fall back to
# `file` content sniffing on a bare system (it says application/json on Arch), so read the database.
check ".excalidraw is in the shared MIME database" sh -c "grep -q 'vnd.excalidraw+json:\*.excalidraw' /usr/share/mime/globs2"
check ".excalidrawlib is in the shared MIME database" sh -c "grep -q 'vnd.excalidrawlib+json:\*.excalidrawlib' /usr/share/mime/globs2"
check "licence installed" sh -c 'ls /usr/share/doc/vaultdraw/copyright /usr/share/licenses/vaultdraw/LICENSE /usr/share/licenses/vaultdraw-bin/LICENSE 2>/dev/null | grep -q .'
check "plugins installed" sh -c 'ls /usr/lib/Vaultdraw/plugins | grep -q markdown-import'

echo "== app under Xvfb (control API and CLI)"
OUT=$(VAULTDRAW_APP_BIN=/usr/bin/excalidraw-vault VAULTDRAW_CLI_BIN=/usr/bin/vaultdraw sh "$HERE/linux-control-check.sh" 2>&1)
printf '%s\n' "$OUT" | grep -E '^(PASS|FAIL)'
printf '%s\n' "$OUT" | grep -q '^FAIL' && FAILS=$((FAILS + 1))
printf '%s\n' "$OUT" | grep -q '^PASS' || fail "control check produced no PASS"

echo "== uninstall"
FILES=$(case "$PKG" in *.deb) dpkg -L vaultdraw ;; *.rpm) rpm -ql vaultdraw ;; *) pacman -Qlq vaultdraw-bin ;; esac | grep -v '/$')
if sh -c "$REMOVE" >/tmp/vd-remove.log 2>&1; then pass "remove"; else fail "remove"; tail -10 /tmp/vd-remove.log; fi
LEFT=0; for f in $FILES; do { [ -f "$f" ] || [ -L "$f" ]; } && { echo "left behind: $f"; LEFT=1; }; done
[ $LEFT = 0 ] && pass "no package file left behind" || fail "files left behind"
check "vaultdraw no longer on PATH" sh -c '! command -v vaultdraw'
[ -d /usr/lib/Vaultdraw ] && fail "/usr/lib/Vaultdraw remains" || pass "/usr/lib/Vaultdraw removed"
rm -rf "$T"
echo "RESULT: $FAILS failure(s)"; [ $FAILS = 0 ]
