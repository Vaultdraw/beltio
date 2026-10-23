/**
 * Custom context keys (plugins): a namespaced id (`<ns>.<name>`) plus a
 * getter. They are read lazily, only when a `when` clause names a key that
 * is not in the built-in context, so the keypress hot path pays nothing
 * while none are defined.
 */
const getters = new Map<string, () => boolean>();
const warned = new Set<string>();

/** Built-in names (see CommandContext); custom ids can never shadow them. */
const BUILTIN_KEYS: ReadonlySet<string> = new Set([
  "vaultOpen",
  "drawingOpen",
  "writable",
  "textEditing",
  "canvasFocus",
  "modalOpen",
  "listFocus",
]);

const NAMESPACED = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_.-]+$/;

/** Register a context key; the returned function removes it again. */
export function defineContextKey(id: string, get: () => boolean): () => void {
  if (BUILTIN_KEYS.has(id) || !NAMESPACED.test(id)) {
    console.warn(`Context key "${id}" refused: use a namespaced id (ns.name)`);
    return () => {};
  }
  if (getters.has(id)) {
    console.warn(`Context key "${id}" is already defined; keeping the first`);
    return () => {};
  }
  getters.set(id, get);
  warned.delete(id);
  return () => {
    if (getters.get(id) === get) {
      getters.delete(id);
    }
  };
}

/** Value of a custom key: unknown = false; a throwing getter = false (warns once). */
export function readCustomContextKey(id: string): boolean {
  const get = getters.get(id);
  if (!get) {
    return false;
  }
  try {
    return !!get();
  } catch (err) {
    if (!warned.has(id)) {
      warned.add(id);
      console.warn(`Context key "${id}" threw; treating it as false`, err);
    }
    return false;
  }
}
