# Building and packaging

Turn a TypeScript project into one `main.js`, then into a zip you can share. Both steps check the plugin first.

## build

```bash
vaultdraw-plugin build [dir] [--watch]
```

`dir` defaults to the current folder. `build` bundles the project with esbuild into `dist/`:

| Output | Content |
| --- | --- |
| `dist/plugin.toml` | The manifest, copied unchanged |
| `dist/<main>` | The bundle, at the path `main` names (default `main.js`) |
| `dist/README*`, `dist/LICENSE*`, `dist/assets/` | Copied from the project root (`README*` and `LICENSE*` at the top level only, any case) |

- The entry is `entry` under `[x-build]` in `plugin.toml` (a relative path), else the first of `src/main.ts`, `src/main.tsx`, `src/main.js` that exists. The app and `check` ignore `x-*` tables; a plain `[build]` table would be an unknown key.

  ```toml
  [x-build]
  entry = "src/index.ts"
  ```

- Format is ESM for `es2022`. The shared modules (`react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@vaultdraw/api`, `@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/commands`, `@lezer/common`, `@lezer/highlight`) stay imports; the app provides them (the CodeMirror ones load on first import). Everything else is bundled in. JSX uses the automatic runtime.
- The command prints each output with its size and warns above 100 KB. It exits 1 when esbuild reports errors or no entry exists, and 2 when esbuild is not installed or the folder is missing.
- `--watch` rebuilds on every change and prints `rebuilt` with the time when the bundle changed. `dev` does the same for a project that has a source entry and no `main` file next to `plugin.toml`: it builds into `dist/` and mirrors `dist/` into the plugins folder.
- esbuild is the one dependency. It is loaded from your project first (`npm install --save-dev esbuild`), then from next to the command.

`check dist` and `package dist` work on the output.

## package

```bash
vaultdraw-plugin package <dir> [--out <dir>] [--json]
```

`package` runs `check` and refuses on errors (exit 1, nothing written). It packages the folder you give. Only when that folder has no `main` file and `<dir>/dist/plugin.toml` exists does it package `<dir>/dist`. It writes two files, by default into the current folder:

| File | Content |
| --- | --- |
| `<id>-<version>.zip` | The plugin |
| `<id>-<version>.zip.sha256` | `<hex> <zip file name>` (two spaces, then a newline) |

The zip holds every file of the folder, except dot-files and dot-folders, `node_modules` and files with `.test.` in the name. (So pack `dist`, not a project root: the root would also ship `tsconfig.json` and the like.) The layout is fixed, because a registry reads it:

1. Flat. `plugin.toml` and `main.js` sit at the zip root. No top folder.
2. Entry names use `/`, are relative and UTF-8, and are sorted by byte order. No directory entries.
3. Reproducible. Every entry has the time 1980-01-01 00:00:00, one mode (0644), no extra fields and no comment. The same input gives the same bytes on the same Node build; zlib output can differ between zlib versions.
4. Entries under 64 bytes are stored. Larger ones are deflated (level 9) when that is smaller.

A package has at most 1000 files and 8 MB uncompressed; `package` refuses above that.

`--json` prints `{ schemaVersion: 1, ok, file, sha256, bytes, entries }`. When the check fails it prints `{ schemaVersion: 1, ok: false, errors, warnings }`. Without `--json`, warnings go to stderr and the output ends with `sha256 <hex>`.

## check a zip

```bash
vaultdraw-plugin check my-plugin-0.1.0.zip
```

`check` takes a file that ends in `.zip`. It verifies the `.sha256` file when it sits next to the zip (the first 64 hex characters of the file), reads the archive strictly, then runs the usual checks on the contents. The findings name zip entries.

| Code | Meaning |
| --- | --- |
| `zip-checksum` | The zip does not match its `.sha256` file |
| `zip-invalid` | The archive is not one the reader accepts |
| `zip-layout` | `plugin.toml` is inside a single top folder, not at the root |

The reader rejects absolute paths, drive letters, `.` and `..` segments, backslashes, control characters, names that repeat (also by case), symbolic links, encrypted entries, zip64, multi-disk archives, a zip comment, methods other than stored and deflate, wrong sizes or CRCs, more than 1000 entries and more than 8 MB uncompressed.

## What a registry reads

A registry that takes plugins reads a zip like this: the flat layout above, `plugin.toml` at the root with a valid manifest, the `.sha256` file for integrity, and the output of `check --json` for the verdict. Nothing else is needed. No registry exists yet.
