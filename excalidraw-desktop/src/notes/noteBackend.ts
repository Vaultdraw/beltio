/**
 * Which NoteFiles the notes extension reads and writes through: the desktop
 * commands (`read_note`, `write_note`, see noteFiles.ts) unless a test or the
 * browser harness installs the in-memory fake.
 */
import { DesktopNoteFiles } from "./noteFiles";

import type { NoteFiles } from "./noteFiles";

const desktop = new DesktopNoteFiles();
let current: NoteFiles = desktop;

export const getNoteFiles = (): NoteFiles => current;

/** Replaces the backend; null restores the desktop one. */
export const setNoteFiles = (next: NoteFiles | null): void => {
  current = next ?? desktop;
};
