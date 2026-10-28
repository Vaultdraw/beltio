/**
 * Does a `config-change` batch concern `<config dir>/<name>/`?
 *
 * The watcher may spell a path differently from the configured folder:
 * macOS canonical `/private/var/...` for `/var/...`, a Windows `\\?\` prefix
 * or drive-letter case, or the target of a symlinked config folder. So paths
 * are normalised (separators, case, those prefixes) and compared with the
 * root; a path that is not under the root (a symlink target, an unknown
 * spelling) still counts when it has a `/<name>/` segment. A wrong "yes" only
 * costs one folder listing; a wrong "no" would silently stop live reload.
 * Unknown input, an empty batch or the root itself (the watcher's "something
 * changed" fallback) count as a change.
 */
const norm = (p: string) =>
  p
    .replace(/\\/g, "/")
    .replace(/^\/\/[?.]\//, "")
    .replace(/^\/private\/(?=var\/|tmp\/|etc\/)/, "/")
    .replace(/\/+$/, "")
    .toLowerCase();

export function touchesConfigSubdir(
  paths: unknown,
  name: string,
  configDir: string | null,
): boolean {
  if (!Array.isArray(paths) || paths.length === 0) {
    return true;
  }
  const sub = name.toLowerCase();
  const segment = new RegExp(`/${sub}(/|$)`);
  const root = configDir ? norm(configDir) : null;
  const prefix = `${root}/${sub}`;
  return paths.some((p) => {
    if (typeof p !== "string") {
      return false;
    }
    const path = norm(p);
    if (root === null) {
      return segment.test(path);
    }
    if (path === root || path === prefix || path.startsWith(`${prefix}/`)) {
      return true;
    }
    // Under the root but in another folder: not ours (themes/snippets/x).
    if (path.startsWith(`${root}/`)) {
      return false;
    }
    return segment.test(path);
  });
}

/** Folders of the config folder that hold no settings: plugins, themes and CSS snippets have their own listeners. */
const NON_SETTINGS = new Set(["plugins", "themes", "snippets"]);

/**
 * True when a non-empty `config-change` batch only names files inside the config folder that no
 * settings layer reads: under `plugins/`, `themes/` or `snippets/`, or in a dot folder (`.git`).
 * Everything else reloads the settings: `config.toml`, `overrides.toml`, profiles, `keys`, includes
 * (which may sit anywhere), the state files, and any path outside the folder (an unknown spelling).
 * Unknown input and the root itself count as a settings change.
 */
export function isNonSettingsBatch(
  paths: unknown,
  configDir: string | null,
): boolean {
  if (!configDir || !Array.isArray(paths) || paths.length === 0) {
    return false;
  }
  const root = `${norm(configDir)}/`;
  return paths.every((p) => {
    if (typeof p !== "string") {
      return false;
    }
    const path = norm(p);
    if (!path.startsWith(root)) {
      return false;
    }
    const segments = path.slice(root.length).split("/");
    return (
      NON_SETTINGS.has(segments[0]) || segments.some((s) => s.startsWith("."))
    );
  });
}
