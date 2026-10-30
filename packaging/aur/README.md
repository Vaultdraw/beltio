# AUR package: `vaultdraw-bin`

Installs Vaultdraw on Arch Linux from the `.deb` of a GitHub release. The AUR upload is the owner's job; nothing here publishes anything.

| File | Purpose |
| --- | --- |
| `PKGBUILD` | The recipe. Downloads `Vaultdraw_<version>_amd64.deb`, unpacks it, installs the licence. |
| `.SRCINFO` | Metadata the AUR reads. Regenerated from `PKGBUILD`. |
| `update.sh` | Fills the checksum from the release's `SHA256SUMS` and rewrites `.SRCINFO`. |

## One-time setup

1. Create an account at <https://aur.archlinux.org/register>.
2. Make an SSH key (`ssh-keygen -t ed25519 -f ~/.ssh/aur`) and paste `~/.ssh/aur.pub` into **My Account, SSH Public Key**.
3. Add to `~/.ssh/config`:
   ```
   Host aur.archlinux.org
     IdentityFile ~/.ssh/aur
     User aur
   ```
4. Clone the (still empty) package repository: `git clone ssh://aur@aur.archlinux.org/vaultdraw-bin.git`.

## Publish a release (on Arch, or an Arch container)

1. Publish the GitHub release first, so the `.deb` and `SHA256SUMS` are public.
2. Copy `PKGBUILD`, `.SRCINFO` and `update.sh` from this folder into the AUR clone.
3. `./update.sh 0.2.0` (the version without the `v`). It sets `pkgver`, the checksum and `.SRCINFO`.
4. Test it: `makepkg -si`. Then `vaultdraw --version` and start Vaultdraw from the application menu.
5. `git add PKGBUILD .SRCINFO && git commit -m "vaultdraw-bin 0.2.0" && git push` (the branch must be `master`).
6. Copy the updated `PKGBUILD` and `.SRCINFO` back into this folder and commit them.

A new release is the same steps from 1. If only the packaging changes, raise `pkgrel` by hand, run `makepkg --printsrcinfo > .SRCINFO`, and push.

## Notes

- The package is `x86_64` only, because the release workflow builds the Linux `.deb` on an x86_64 runner.
- `conflicts` and `provides` use the name `vaultdraw`, so a future source package of that name replaces it cleanly.
- `LOCAL_DEB_DIR=/folder makepkg -si` builds from a `.deb` on disk instead of GitHub (checksums skipped), which is how it was tested.
