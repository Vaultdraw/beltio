#!/bin/sh
# Fill the checksums of PKGBUILD from a published release and rewrite .SRCINFO.
# Usage: ./update.sh 0.2.0      (run on Arch, in this folder, after the release is public)
set -eu
ver="${1:?usage: update.sh <version>}"
base="https://github.com/Vaultdraw/vaultdraw/releases/download/v$ver"
sums=$(curl -fsSL "$base/SHA256SUMS")
sum_of() { printf '%s\n' "$sums" | awk -v f="$1" '$2==f || $2=="*"f {print $1}'; }
amd=$(sum_of "Vaultdraw_${ver}_amd64.deb")
[ -n "$amd" ] || { echo "no amd64 .deb in SHA256SUMS" >&2; exit 1; }
sed -i "s/^pkgver=.*/pkgver=$ver/; s/^pkgrel=.*/pkgrel=1/" PKGBUILD
sed -i "s/^sha256sums_x86_64=.*/sha256sums_x86_64=('$amd')/" PKGBUILD
makepkg --printsrcinfo > .SRCINFO
echo "updated to $ver; check the diff, then see README.md"
