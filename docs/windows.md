# Vaultdraw on Windows

Windows 10 and 11, 64-bit. The installer is a per-user NSIS setup: no administrator rights needed.

## Install

1. Download `Vaultdraw_<version>_x64-setup.exe` from the release page.
2. Run it. Windows may warn first (see below).
3. Start Vaultdraw from the Start menu and open or create a vault.

The installer carries the WebView2 bootstrapper, so it works when the WebView2 runtime is missing and the download is blocked. Windows 10 and 11 normally have it already.

## The `vaultdraw` command

The installer adds its folder to your user `PATH`, so `vaultdraw` works in any **new** terminal (PowerShell, cmd, Windows Terminal). Uninstalling removes the entry. Nothing outside your user's `Path` is changed. See [the command](cli.md).

## SmartScreen warning

The installer is **not signed yet**, so Windows SmartScreen shows "Windows protected your PC" the first time.

1. Click **More info**.
2. Click **Run anyway**.

Signing needs a paid code-signing certificate; it is an owner decision. Until then the warning is expected, and the checksum on the release page lets you verify the download.

## Not on Windows yet

| Feature | Status |
| --- | --- |
| PDF import | not available yet; planned with the built-in Windows PDF renderer |
| Memory-pressure features, smoke and performance tooling | macOS only |

Everything else (vaults, drawings, the command palette, config, themes, plugins, search, the `vaultdraw` command) is the same as on macOS.

## Build it yourself

`yarn tauri build` on Windows (Node 22, Rust stable) writes the installer to `excalidraw-desktop/src-tauri/target/release/bundle/nsis/`. The `windows` workflow in `.github/workflows/windows.yml` does the same and uploads it as an artefact.
