/**
 * Does a `config-change` batch concern `<config dir>/<name>/`? Paths are
 * matched against the config root (case-insensitively, either separator).
 * Unknown input, an empty batch or the root itself (the watcher's "something
 * changed" fallback) count as a change. Without a known root, any path
 * segment named `name` matches.
 */
const norm = (p: string) =>
  p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

export function touchesConfigSubdir(
  paths: unknown,
  name: string,
  configDir: string | null,
): boolean {
  if (!Array.isArray(paths) || paths.length === 0) {
    return true;
  }
  const sub = name.toLowerCase();
  if (!configDir) {
    const segment = new RegExp(`/${sub}(/|$)`);
    return paths.some((p) => typeof p === "string" && segment.test(norm(p)));
  }
  const root = norm(configDir);
  const prefix = `${root}/${sub}`;
  return paths.some((p) => {
    if (typeof p !== "string") {
      return false;
    }
    const path = norm(p);
    return path === root || path === prefix || path.startsWith(`${prefix}/`);
  });
}
