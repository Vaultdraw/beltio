/** What a plugin's "Insert shape" palette command and toolbar button run once the plugin has loaded. */
const inserters = new Map<string, () => Promise<unknown>>();

export function setShapeInserter(
  key: string,
  insert: () => Promise<unknown>,
): () => void {
  inserters.set(key, insert);
  return () => {
    if (inserters.get(key) === insert) {
      inserters.delete(key);
    }
  };
}

export const getShapeInserter = (key: string) => inserters.get(key);
