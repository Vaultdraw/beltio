/**
 * Renamed command ids. A command that changes id (it moved into an official
 * extension, say) keeps its old id working here, so a key bound to the old id
 * in `config.toml` `[hotkeys]`, a palette entry, a script calling
 * `vaultdraw cmd run <id>` or a `vaultdraw://` link keeps working.
 *
 * Resolved lazily, at dispatch and when the keymap is built, never against
 * the registry: the new command may come from a plugin that registers later,
 * or may be off, in which case the old id is simply unavailable.
 */

/** Old id -> new id. Append a row whenever an id is renamed; never delete one. */
export const COMMAND_ALIASES: Readonly<Record<string, string>> = {
  "thumbnails.galleryToggle": "gallery.toggle",
  "thumbnails.galleryOpen": "gallery.show-folder",
  "file.importPdf": "pdf-import.import",
};

const noticed = new Set<string>();

/** The current id for `id` (itself when it is not an old id), no notice. */
export function aliasTarget(id: string): string {
  let current = id;
  // Chains (a -> b -> c) resolve; the hop cap guards a table typo (a cycle).
  for (let hops = 0; hops < 8; hops++) {
    const next = Object.prototype.hasOwnProperty.call(COMMAND_ALIASES, current)
      ? COMMAND_ALIASES[current]
      : undefined;
    if (next === undefined) {
      break;
    }
    current = next;
  }
  return current;
}

export const isAliasId = (id: string): boolean => aliasTarget(id) !== id;

/** Like `aliasTarget`, and logs one notice per old id the first time it is used. */
export function resolveCommandId(id: string): string {
  const target = aliasTarget(id);
  if (target !== id && !noticed.has(id)) {
    noticed.add(id);
    console.info(
      `Command "${id}" was renamed "${target}"; the old id still works.`,
    );
  }
  return target;
}

/** Every old id that now means `id`. */
export function aliasesOf(id: string): string[] {
  return Object.keys(COMMAND_ALIASES).filter((old) => aliasTarget(old) === id);
}

/** Test hook: forget which notices were logged. */
export const resetAliasNotices = (): void => noticed.clear();
