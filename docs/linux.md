# Vaultdraw on Linux

Debian and Ubuntu, Fedora, Arch, or any distribution through the AppImage. 64-bit Intel and AMD (x86_64).

Replace `0.2.0` below with the version you want. Files are on the [release page](https://github.com/Vaultdraw/vaultdraw/releases/latest).

## Install

| Distribution | One command |
| --- | --- |
| Debian, Ubuntu, Mint | `curl -LO https://github.com/Vaultdraw/vaultdraw/releases/download/v0.2.0/Vaultdraw_0.2.0_amd64.deb && sudo apt install ./Vaultdraw_0.2.0_amd64.deb` |
| Fedora, RHEL-like | `sudo dnf install https://github.com/Vaultdraw/vaultdraw/releases/download/v0.2.0/Vaultdraw-0.2.0-1.x86_64.rpm` |
| Arch, Manjaro (AUR) | `yay -S vaultdraw-bin` (or `paru -S vaultdraw-bin`, or `git clone https://aur.archlinux.org/vaultdraw-bin.git && cd vaultdraw-bin && makepkg -si`) |
| Any other | `curl -LO https://github.com/Vaultdraw/vaultdraw/releases/download/v0.2.0/Vaultdraw_0.2.0_amd64.AppImage && chmod +x Vaultdraw_0.2.0_amd64.AppImage && ./Vaultdraw_0.2.0_amd64.AppImage` |

The package manager installs the libraries Vaultdraw needs (WebKitGTK 4.1, GTK 3, poppler). The builds are unsigned: check the download against `SHA256SUMS` on the release page (`sha256sum -c --ignore-missing SHA256SUMS`).

## Start it

Open **Vaultdraw** from the application menu. In a terminal, `excalidraw-vault` starts the app and `vaultdraw` is the [command line tool](cli.md); both are in `/usr/bin` after a package install.

```sh
vaultdraw --version
```

Double-clicking a `.excalidraw` file in the file manager opens it in Vaultdraw (choose **Open With** the first time if another app owns the type).

## What a package installs

| Path | What |
| --- | --- |
| `/usr/bin/excalidraw-vault` | the app |
| `/usr/bin/vaultdraw` | the command line tool |
| `/usr/lib/Vaultdraw/` | the official plugins and the licence |
| `/usr/share/applications/Vaultdraw.desktop` | the application menu entry (opens `.excalidraw`, `.excalidrawlib` and `vaultdraw://` links) |
| `/usr/share/mime/packages/vaultdraw.xml` | the file types |
| `/usr/share/icons/hicolor/*/apps/excalidraw-vault.png` | the icon |

Your vaults, settings and state live in your home folder and are never touched by the package. Uninstalling removes only the files above:

| Distribution | Uninstall |
| --- | --- |
| Debian, Ubuntu | `sudo apt remove vaultdraw` |
| Fedora | `sudo dnf remove vaultdraw` |
| Arch | `sudo pacman -Rns vaultdraw-bin` |

## The AppImage

Needs no install and no root. To get a menu entry and file association, run **Links: Register Vaultdraw for links and files** from the command palette. See [uri-scheme.md](uri-scheme.md).

## Known limits

- x86_64 only for now. The ARM build exists but is not in the release.
- The checks ran headless (Xvfb) on Debian 12, Fedora 44 and Arch. If a window looks wrong on Wayland, try `GDK_BACKEND=x11 excalidraw-vault`.

## For the maintainer: publishing a release for Linux

1. Tag and release as in [releasing.md](releasing.md). The release workflow builds the `.deb`, `.rpm` and AppImage and lists them in `SHA256SUMS`.
2. Publish the draft release.
3. Update the AUR package: follow [packaging/aur/README.md](../packaging/aur/README.md) (`./update.sh <version>`, `makepkg -si`, `git push`).
4. Check on a clean machine: install, `vaultdraw --version`, start the app. `excalidraw-desktop/scripts/linux-package-check.sh <package>` does this headless.
