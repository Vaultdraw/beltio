/**
 * The rules that keep the public API surface frozen. `etc/api-surface.d.ts` is the pinned
 * text; it starts with `// @vaultdraw/api <version>`. A change to it needs a new version
 * in `package.json`; a line that disappears (a removal or a changed signature) needs a new
 * major version, unless it belongs to an `@experimental` declaration.
 */
export const HEADER_RE = /^\/\/ @vaultdraw\/api (\d+\.\d+\.\d+)\n/;

export const withHeader = (version: string, body: string): string =>
  `// @vaultdraw/api ${version}\n${body}`;

export const versionOf = (snapshot: string): string | null =>
  HEADER_RE.exec(snapshot)?.[1] ?? null;

const major = (v: string): number => Number(v.split(".")[0]);
const cmp = (a: string, b: string): number => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) {
      return x[i] - y[i];
    }
  }
  return 0;
};

const DECL_RE = /^export (?:declare )?(?:interface|type|const|class) (\w+)/;

/** Lines of `old` that `next` no longer has, minus lines of experimental declarations. */
export const removedLines = (
  old: string,
  next: string,
  experimental: ReadonlySet<string>,
): string[] => {
  const have = new Set(next.split("\n"));
  const mentions = (line: string) =>
    [...experimental].some((n) => new RegExp(`\\b${n}\\b`).test(line));
  const out: string[] = [];
  let current = "";
  for (const line of old.split("\n")) {
    const d = DECL_RE.exec(line);
    if (d) {
      current = d[1];
    } else if (/^\/\/ /.test(line)) {
      current = "";
    }
    if (
      line.trim() !== "" &&
      !line.startsWith("// @vaultdraw/api ") &&
      !have.has(line) &&
      !experimental.has(current) &&
      !mentions(line)
    ) {
      out.push(line);
    }
  }
  return out;
};

/** Why `next` may not replace `old` when the package says `version`; null when it may. */
export const refuseUpdate = (
  old: string | null,
  next: string,
  version: string,
  experimental: ReadonlySet<string>,
): string | null => {
  const oldVersion = old ? versionOf(old) : null;
  if (!old || !oldVersion) {
    return null; // first snapshot
  }
  if (old === next) {
    return null;
  }
  if (cmp(version, oldVersion) <= 0) {
    return `The surface changed but sdk/api/package.json is still ${oldVersion}. Raise the version first (a minor for an addition or a deprecation, a major for a removal) and add its entry to sdk/api/CHANGELOG.md.`;
  }
  if (major(version) === major(oldVersion)) {
    const gone = removedLines(old, next, experimental);
    if (gone.length > 0) {
      return `A removal or a changed signature needs a major version (now ${version}). Removed or changed:\n${gone
        .slice(0, 8)
        .join("\n")}`;
    }
  }
  return null;
};
