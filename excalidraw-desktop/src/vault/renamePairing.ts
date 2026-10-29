/**
 * A file renamed or moved outside the app (Finder, git, sync) arrives as one watcher batch with
 * the old and the new paths. These are the paths where `path` may have gone: every other path of
 * the batch, and, when a folder above it was renamed, the same file under each other path. The
 * caller keeps the one whose revision equals the revision it last saw (hunter C-4): only the
 * same bytes count, so an unrelated create in the same batch is never taken for the rename.
 */
export const MAX_RENAME_PROBES = 32;

export const renameCandidates = (
  path: string,
  batch: readonly string[],
): string[] => {
  const gone = batch.filter((p) => p === path || path.startsWith(`${p}/`));
  const out = new Set<string>();
  for (const p of batch) {
    if (p === path || gone.includes(p)) {
      continue;
    }
    out.add(p);
    for (const g of gone) {
      out.add(`${p}${path.slice(g.length)}`);
    }
  }
  const ext = path.slice(path.lastIndexOf("."));
  return [...out].filter((c) => c.endsWith(ext)).slice(0, MAX_RENAME_PROBES);
};

/** The first candidate whose revision is `revision`, or null. */
export const findRenamed = async (
  path: string,
  revision: string,
  batch: readonly string[],
  revisionAt: (candidate: string) => Promise<string | null>,
): Promise<string | null> => {
  for (const c of renameCandidates(path, batch)) {
    if ((await revisionAt(c).catch(() => null)) === revision) {
      return c;
    }
  }
  return null;
};
