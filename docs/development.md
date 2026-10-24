# Developing Vaultdraw

Notes for contributors. Back to the [README](../README.md).

## Repository layout

| Path | What it is |
| --- | --- |
| `excalidraw-desktop/` | The Vaultdraw desktop app (Tauri 2 + React) |
| `excalidraw-desktop/src-tauri/` | Rust backend: filesystem access, file watcher, recovery |
| `packages/excalidraw/` | The Excalidraw editor |
| `packages/{common,element,math,utils,fractional-indexing,laser-pointer}` | Editor building blocks |

## Development

Requires Node 18+, Yarn 1 and the [Rust/Tauri prerequisites](https://tauri.app/start/prerequisites/).

```bash
yarn install
yarn start               # run the desktop app in dev mode
yarn desktop:build       # build the packaged app
yarn desktop:test        # desktop unit tests
yarn test:typecheck      # TypeScript
yarn test:app            # all unit tests (editor + desktop)
yarn --cwd excalidraw-desktop test:e2e   # Playwright browser tests
```

### Adding a command

Every feature registers its actions so they show in the palette and on the Hotkeys page:

1. Add an entry (metadata only: `id`, `title`, `category`, `keys`, `when`) to `COMMANDS` in `excalidraw-desktop/src/commands/commands.ts`, or to `editorCommands.ts` if the open editor owns it. Name choices `"Family: Choice"` so Tab can narrow to the family.
2. Bind the handler: app-shell actions in `useAppCommands.ts`; anything else with `registerCommandHandlers({ [id]: run })` while it is mounted.
3. Entries that depend on data (one per theme, pen, library item) are a provider: `registerPaletteProvider({ id, items: () => [...] })` from `src/palette/registry.ts`. `items()` runs only when commands mode opens.

## Linux builds

Linux support is being built without a Linux machine at hand, so treat it as untried until a run on one confirms it.

- `src-tauri/tauri.linux.conf.json` is merged over `tauri.conf.json` by the Tauri CLI on Linux (arrays such as `windows` are replaced whole, `null` deletes a key). It drops the macOS-only window keys and builds `deb` and `appimage` bundles. `scripts/tauri-linux-conf.test.mjs` merges the two files the same way and checks the result against Tauri's config schema.
- `scripts/build-cli.mjs` builds the `vaultdraw` sidecar for the target triple (for example `x86_64-unknown-linux-gnu`) and names it `vaultdraw-<triple>`. The naming is in `scripts/cli-targets.mjs`, tested by `scripts/cli-targets.test.mjs`.
- Build needs the WebKitGTK 4.1 and GTK 3 development packages (on Debian and Ubuntu: `libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev librsvg2-dev patchelf`).
- Bug reports show the distribution from `/etc/os-release` as the system version.

