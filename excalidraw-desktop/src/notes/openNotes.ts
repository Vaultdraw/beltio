/**
 * The open note editors, so app-level steps (quit, window close, vault
 * switch) can write what is pending. Each NoteView registers its saver while
 * it is mounted. Costs nothing until a note is open.
 */
import type { SaveStatus } from "./noteSaver";

export interface OpenNote {
  path: string;
  state: () => SaveStatus;
  flush: () => Promise<void>;
  /** The revision on disk the note's text matches (what a rename outside keeps). */
  revision?: () => string;
}

const open = new Set<OpenNote>();

export function registerOpenNote(note: OpenNote): () => void {
  open.add(note);
  return () => {
    open.delete(note);
  };
}

const UNSAVED: SaveStatus[] = ["dirty", "saving", "error", "conflict"];

/** Paths of notes with text that is not on disk. */
export function unsavedNotePaths(): string[] {
  return [...open]
    .filter((n) => UNSAVED.includes(n.state()))
    .map((n) => n.path);
}

/** Thrown by flushOpenNotes: which notes are still unsaved. */
export class NotesUnsavedError extends Error {
  constructor(readonly paths: string[]) {
    super(`Could not save ${paths.join(", ")}`);
    this.name = "NotesUnsavedError";
  }
}

/** Note names for a dialog: "a.md", "a.md and b.md", "a.md, b.md, c.md and 2 more". */
export function describeNotes(paths: readonly string[]): string {
  const names = paths.map((p) => `'${p.split("/").pop() ?? p}'`);
  if (names.length <= 1) {
    return names.join("");
  }
  if (names.length <= 3) {
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

/**
 * Writes every open note, each on its own (one failing note never stops the others); rejects with
 * the notes that are still unsaved afterwards.
 */
export async function flushOpenNotes(): Promise<void> {
  const notes = [...open];
  await Promise.allSettled(notes.map((n) => n.flush()));
  const left = notes.filter((n) => UNSAVED.includes(n.state()));
  if (left.length > 0) {
    throw new NotesUnsavedError(left.map((n) => n.path));
  }
}

/**
 * The revision of an open note whose text is all on disk, else null (nothing pending, so a
 * rename outside can be followed without a write landing on the old path).
 */
export function savedNoteRevision(path: string): string | null {
  for (const n of open) {
    if (n.path === path && n.state() === "saved" && n.revision) {
      return n.revision();
    }
  }
  return null;
}
