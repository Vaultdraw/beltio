/** Most "(import N)" folders tried before the plain name is used anyway. */
const MAX_TRIES = 50;

const isMissing = (err: unknown): boolean =>
  (err as { code?: string } | null)?.code === "NOT_FOUND";

/**
 * The vault folder an Obsidian import writes into, decided before anything is
 * written: `name` when it does not exist or is empty, else the first free
 * "name (import N)" (N from 2). A repeated import then never mixes with an
 * earlier one, so its rewritten links cannot point at the old copy.
 */
export async function chooseImportFolder(
  name: string,
  list: (dir: string) => Promise<readonly unknown[]>,
): Promise<string> {
  const empty = async (dir: string): Promise<boolean> => {
    try {
      return (await list(dir)).length === 0;
    } catch (err) {
      if (isMissing(err)) {
        return true;
      }
      throw err;
    }
  };
  if (await empty(name)) {
    return name;
  }
  for (let n = 2; n < MAX_TRIES; n++) {
    const candidate = `${name} (import ${n})`;
    if (await empty(candidate)) {
      return candidate;
    }
  }
  return name;
}
