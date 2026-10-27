/**
 * The notes extension's one hook into the app: a tab kind for Markdown
 * files. Registering is a few object allocations; the view (and everything
 * under it) is a lazy chunk that loads when the first note tab is shown.
 * Called with `true` while `[extensions] notes` is on, `false` removes it.
 */
import { registerTabKind } from "../tabs/tabKinds";

export const NOTES_KIND_ID = "notes.note";

const MARKDOWN = /\.(?:md|markdown)$/i;
/** Obsidian's `.excalidraw.md` is a drawing, never a note (FileKind). */
const OBSIDIAN_DRAWING = /\.excalidraw\.md$/i;

export const isNotePath = (path: string): boolean =>
  MARKDOWN.test(path) && !OBSIDIAN_DRAWING.test(path);

let dispose: (() => void) | null = null;

export function setNotesKind(on: boolean): void {
  if (on && !dispose) {
    dispose = registerTabKind({
      id: NOTES_KIND_ID,
      pluginId: "notes",
      matches: isNotePath,
      load: () => import("./NoteView"),
    });
  } else if (!on && dispose) {
    dispose();
    dispose = null;
  }
}
