/**
 * Resolves the `[[target]]` of a note to a vault path the way Obsidian does:
 * a path (`Folder/Note`) or just a name, with or without `.md`; the match is
 * case-insensitive; when several files share a name the one closest to the
 * linking note wins. Notes and drawings share one namespace (`Name` finds
 * `Name.md`, else `Name.excalidraw`); other files (images, PDFs) need their
 * extension. The index is built once per file list.
 */
const fold = (s: string) => s.toLowerCase().normalize("NFC");
const NOTE_EXT = /\.(?:md|markdown)$/i;
const DRAWING_EXT = /\.excalidraw$/i;

const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const folder = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));

const shared = (a: string, b: string): number => {
  const x = a.split("/");
  const y = b.split("/");
  let n = 0;
  while (n < x.length && n < y.length && x[n] === y[n]) {
    n++;
  }
  return n;
};

export interface NoteLinkIndex {
  resolve: (fromPath: string, target: string) => string | null;
}

export function createNoteLinkIndex(paths: readonly string[]): NoteLinkIndex {
  const byFull = new Map<string, string[]>();
  const byBase = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, path: string) => {
    const list = map.get(key);
    if (list) {
      list.push(path);
    } else {
      map.set(key, [path]);
    }
  };
  for (const path of paths) {
    const noExt = path.replace(NOTE_EXT, "").replace(DRAWING_EXT, "");
    const isDoc = noExt !== path;
    for (const key of isDoc ? [fold(path), fold(noExt)] : [fold(path)]) {
      add(byFull, key, path);
      add(byBase, fold(base(key)), path);
    }
  }
  // A note beats a drawing of the same name.
  const rank = (p: string) =>
    NOTE_EXT.test(p) ? 0 : DRAWING_EXT.test(p) ? 1 : 2;
  const pick = (from: string, list: string[] | undefined): string | null => {
    if (!list || list.length === 0) {
      return null;
    }
    const unique = [...new Set(list)];
    unique.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        shared(folder(from), folder(b)) - shared(folder(from), folder(a)) ||
        a.length - b.length ||
        (a < b ? -1 : 1),
    );
    return unique[0];
  };
  return {
    resolve(fromPath, target) {
      const clean = target.trim().replace(/^\/+/, "");
      if (!clean) {
        return null;
      }
      const key = fold(clean);
      const explicit = key.startsWith("./") || key.startsWith("../");
      if (explicit) {
        const parts = folder(fromPath) ? folder(fromPath).split("/") : [];
        for (const seg of clean.split("/")) {
          if (seg === "..") {
            parts.pop();
          } else if (seg !== ".") {
            parts.push(seg);
          }
        }
        return pick(fromPath, byFull.get(fold(parts.join("/"))));
      }
      const full = pick(fromPath, byFull.get(key));
      if (full) {
        return full;
      }
      if (key.includes("/")) {
        const suffix = `/${key}`;
        const tail = byBase.get(base(key)) ?? [];
        return pick(
          fromPath,
          tail.filter((p) => {
            const f = fold(p);
            return (
              f.endsWith(suffix) ||
              fold(p.replace(NOTE_EXT, "").replace(DRAWING_EXT, "")).endsWith(
                suffix,
              )
            );
          }),
        );
      }
      return pick(fromPath, byBase.get(key));
    },
  };
}
