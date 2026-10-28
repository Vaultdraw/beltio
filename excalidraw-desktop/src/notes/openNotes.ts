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

/** Writes every open note; rejects when any note is still unsaved afterwards. */
export async function flushOpenNotes(): Promise<void> {
  const notes = [...open];
  await Promise.all(notes.map((n) => n.flush()));
  const left = notes.filter((n) => UNSAVED.includes(n.state()));
  if (left.length > 0) {
    throw new Error(`Could not save ${left.map((n) => n.path).join(", ")}`);
  }
}
