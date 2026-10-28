# Words in the app

The word list for every string people read in Vaultdraw: Settings, dialogs, menus, notices, plugin panels. The guard test `src/tests/userStrings.guard.test.ts` checks the rules marked **(guarded)**.

## Rules

| Rule | Write | Not |
| --- | --- | --- |
| Sentence case for labels, buttons, titles **(guarded for setting labels)** | Default font family | Default Font Family |
| British spelling, one per word **(guarded: Colour)** | colour, licence, favourites | color, license |
| "…" (one character) only when more input follows, or for a busy state **(guarded: no "...")** | Rename…, Saving… | Rename..., Delete… (no dialog) |
| "and", not "&" **(guarded)** | Save a copy and continue | Save Copy & Continue |
| Real plurals, not "(s)" **(guarded)** | 1 snapshot, 3 snapshots | 3 snapshot(s) |
| No config file names, sections or keys **(guarded)** | your config file, the backup section | config.toml, [backup], plugins.importers |
| No typed keys; show the live binding **(guarded: "Mod+")** | the shortcut chip from the keymap | Press Mod+Alt+J |
| No backticks or command ids in user text **(guarded)** | "Favourite: add or remove" | `favourites.toggle` |
| Errors in plain words, never the raw exception | Couldn't save. The disk is full. | ENOSPC: os error 28 |

## Shared verbs

| Idea | Word |
| --- | --- |
| Put a value back | Restore default |
| Close a notice | Dismiss |
| Delete a file or folder | Move to Trash |
| Show a folder | Open folder (Open config folder, Open themes folder) |
| Consent | Allow / Don't allow |
| Leave a dialog | Cancel |

## Errors

Show errors with `userError(err, fallback)` from `src/components/userError.ts`. It passes through sentences the vault backend writes for people (name collisions, bad names), turns known codes and operating-system failures into plain sentences, and shows `fallback` for anything else. `userErrorDetail(err)` keeps the raw text for logs and reports.
