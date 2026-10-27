# The `vaultdraw` command

A command line tool that talks to the running app over a user-only control socket, and reads your vault straight from disk when the app is closed. Install it from the command palette: **Install 'vaultdraw' command in PATH**.

## Linux

Everything below is checked end to end by `excalidraw-desktop/scripts/linux-control-check.sh` (Xvfb, the app, the CLI, MCP).

### Where things live

| What | Path | Mode |
| --- | --- | --- |
| Config | `$XDG_CONFIG_HOME/vaultdraw`, else `~/.config/vaultdraw` | |
| State | `$XDG_STATE_HOME/vaultdraw`, else `~/.local/state/vaultdraw` | |
| Control socket folder | `$XDG_RUNTIME_DIR/vaultdraw` (`/run/user/<uid>/vaultdraw`) | `0700` |
| Control socket | `<runtime>/ctl.sock` | `0600` |
| Instance lock and info | `<runtime>/instance.lock`, `<runtime>/instance.json` | |

- Without `$XDG_RUNTIME_DIR` the socket folder is `<state>/run`. Override it with `$VAULTDRAW_RUNTIME_DIR`.
- The app refuses a socket folder that is a symlink or belongs to another user, and refuses connections from another user (`SO_PEERCRED`).
- The socket path must stay under 103 bytes; a longer path is a clear error that names `$VAULTDRAW_RUNTIME_DIR`.
- One app runs per user. The lock is held while the app lives, so a stale `ctl.sock` after a crash or `kill` is ignored: `vaultdraw status` says "not running" and the next start replaces it. A normal quit removes the socket and `instance.json`.

### Install the command

| How you run the app | What Install does |
| --- | --- |
| `.deb` (app in `/usr/bin`) | Links `~/.local/bin/vaultdraw` to the CLI next to the app. `/usr/bin/vaultdraw` already exists after the package install. |
| AppImage | **Copies** the CLI to `~/.local/bin/vaultdraw` (mode `0755`, replaced atomically). A link would break, because the AppImage mounts at a new path on every start. Run Install again after updating the app. |

- Put `~/.local/bin` on your `PATH`. The system install (`/usr/local/bin`) needs `sudo`; the error shows the exact command.
- Install never overwrites a file of yours: only a symlink, or an earlier copy of the CLI binary, is replaced.
- `vaultdraw launch` starts `excalidraw-vault` from `PATH`. For an AppImage, set `VAULTDRAW_APP=/path/to/Vaultdraw.AppImage`.

### Headless reads

With the app closed, `vaultdraw --vault <folder> ls` and `cat` read the vault directly (no display needed). With the app running, reads go through the app and `--offline` is refused.
