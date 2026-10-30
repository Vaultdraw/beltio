# Releasing

A release is a tag. Pushing it builds every platform and leaves a **draft** release for you to check. Nothing is published automatically.

## Before the tag

1. Set the version in `excalidraw-desktop/src-tauri/tauri.conf.json` (for example `0.2.0`).
2. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [0.2.0]` and add a new empty `## [Unreleased]` above it.
3. Commit and merge to `main` as usual.

## Push a tag

```sh
git tag v0.2.0
git push origin v0.2.0
```

The tag must be `v` plus the version in `tauri.conf.json`. The first job stops the run if they differ, or if `CHANGELOG.md` has no `## [0.2.0]` section.

## What the workflow does

| Job | Runs on | Result |
| --- | --- | --- |
| version check | Linux | Stops the run on a tag or changelog mismatch |
| build (three jobs) | macOS, Linux, Windows | Bundles: DMG (universal, Intel and Apple silicon), AppImage, deb, NSIS `setup.exe` |
| draft release | Linux | Uploads every bundle and `SHA256SUMS` to a draft release for the tag |

The build jobs cannot write to the repository. Only the last job can.

## Review and publish

1. Open the releases page on GitHub and find the draft `Vaultdraw v0.2.0`.
2. Download one file per platform and check it installs and starts.
3. Compare the file hashes with `SHA256SUMS` (`shasum -a 256 -c SHA256SUMS` on macOS or Linux).
4. Edit the notes if needed. Mark Linux and Windows as experimental if they are not yet tested well enough.
5. Click **Publish release**.

## Dry run

Run the workflow by hand from the Actions tab (**Run workflow**) to build without a tag. It creates a draft for `v` plus the current version, at the chosen commit. Delete that draft before you push the real tag.

## Signing (not set up yet)

The builds are unsigned. macOS Gatekeeper and Windows SmartScreen warn on first run (see `docs/windows.md`). The workflow has commented placeholders for the Apple and Windows signing secrets in `.github/workflows/release.yml`. Adding a certificate is an owner decision, because it costs money and needs a verified identity.

## Re-running

If a release job fails after the builds, run it again from the failed run. The job replaces the files of an existing draft. To start over, delete the draft and the tag, then push the tag again.
