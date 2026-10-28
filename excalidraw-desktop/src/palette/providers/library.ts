/**
 * "Insert: <name>" palette entries (library items, inserted on the canvas). The library feature supplies a
 * LibraryItemSource; until it does, getSource returns null and nothing shows.
 */
import type { PaletteItem, PaletteProvider } from "../types";

export interface LibraryItemSource {
  list(): readonly {
    id: string;
    name: string;
    keywords?: readonly string[];
  }[];
  insert(id: string): void | Promise<void>;
}

export function createLibraryItemsProvider(
  getSource: () => LibraryItemSource | null,
): PaletteProvider {
  return {
    id: "library-items",
    items(): readonly PaletteItem[] {
      const source = getSource();
      if (!source) {
        return [];
      }
      return source.list().map((entry) => ({
        key: `library:${entry.id}`,
        title: `Insert: ${entry.name}`,
        keywords: entry.keywords,
        group: "Library",
        run: () => source.insert(entry.id),
      }));
    },
  };
}

export interface LibraryManageSource {
  /** Libraries that can be renamed or removed, and ones that take imports. */
  sections(): readonly { id: string; label: string; named: boolean }[];
  newLibrary(): void;
  rename(sectionId: string): void;
  remove(sectionId: string): void;
  importInto(sectionId: string): void | Promise<void>;
}

/** "Library: New library", "Library: Import into <name>", rename and remove per library. */
export function createLibraryManageProvider(
  getSource: () => LibraryManageSource | null,
): PaletteProvider {
  return {
    id: "library-manage",
    items(): readonly PaletteItem[] {
      const source = getSource();
      if (!source) {
        return [];
      }
      const item = (
        key: string,
        title: string,
        run: () => void | Promise<void>,
      ): PaletteItem => ({
        key: `library-manage:${key}`,
        title,
        keywords: ["library", "libraries"],
        group: "Library",
        run,
      });
      return [
        item("new", "Library: New library", () => source.newLibrary()),
        ...source
          .sections()
          .flatMap((s) => [
            item(`import:${s.id}`, `Library: Import file into ${s.label}`, () =>
              source.importInto(s.id),
            ),
            ...(s.named
              ? [
                  item(`rename:${s.id}`, `Library: Rename ${s.label}`, () =>
                    source.rename(s.id),
                  ),
                  item(`remove:${s.id}`, `Library: Remove ${s.label}`, () =>
                    source.remove(s.id),
                  ),
                ]
              : []),
          ]),
      ];
    },
  };
}
