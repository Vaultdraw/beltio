import type { LibraryItem } from "@excalidraw/excalidraw/types";

import type { LibraryStore } from "../library/libraryStore";

export interface LibraryImportDeps {
  store: Pick<
    LibraryStore,
    "loadNow" | "assign" | "hasVault" | "isVaultReadOnly"
  >;
  /** Mounted editors (the first one takes the merge). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apis: () => { updateLibrary: (options: any) => Promise<unknown> }[];
  /** Parses and restores a library file's items (the editor's own loader). */
  parse: (json: string) => Promise<readonly LibraryItem[]>;
}

/** Whether the vault library can take items right now. */
export const canAddVaultLibrary = (
  store: Pick<LibraryStore, "hasVault" | "isVaultReadOnly">,
): boolean => store.hasVault() && !store.isVaultReadOnly();

/**
 * Merges an `.excalidrawlib`'s items into the personal or the vault library,
 * through the editor's own merge (it skips items already present and never
 * removes any). The editor's library change then saves the right file.
 */
export async function importLibrary(
  deps: LibraryImportDeps,
  json: string,
  scope: "personal" | "vault",
): Promise<void> {
  const api = deps.apis()[0];
  if (!api) {
    throw new Error(
      "Open a drawing first, then open the library file again: the library is merged in the editor",
    );
  }
  if (scope === "vault" && !canAddVaultLibrary(deps.store)) {
    throw new Error("This vault's library cannot be changed");
  }
  await deps.store.loadNow();
  const items = await deps.parse(json);
  if (scope === "vault") {
    // Record where the new items go before the editor reports the change.
    deps.store.assign(
      items.map((i) => i.id),
      "vault",
    );
  }
  await api.updateLibrary({
    libraryItems: [...items],
    merge: true,
    prompt: false,
    openLibraryMenu: false,
  });
}
