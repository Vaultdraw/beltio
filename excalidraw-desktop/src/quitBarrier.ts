/**
 * The quit barrier: what runs when the window is asked to close. Every flush runs on its own, so
 * one failure never skips the others and "Discard and Close" loses only what could not be saved.
 */
export interface QuitDeps {
  prepareLeave(): void;
  flushDrawing(): Promise<unknown>;
  notesAutosaveOff(): boolean;
  unsavedNotePaths(): string[];
  describeNotes(paths: string[]): string;
  flushOpenNotes(): Promise<unknown>;
  /** The paths of a "notes could not be saved" error, else null. */
  isNotesUnsavedError(e: unknown): string[] | null;
  flushLibrary(): Promise<unknown>;
  flushPluginData(): Promise<unknown>;
  destroyWindow(): Promise<void>;
  /** Autosave is off and notes are dirty: show Save / Don't Save / Cancel. */
  askAboutNotes(): void;
  /** Something could not be saved: show Discard and Close / Keep Window Open. */
  askAboutDiscard(what: string[]): void;
  closed(): void;
}

export async function runQuitBarrier(
  d: QuitDeps,
  decision: { current: "save" | "discard" | null },
): Promise<void> {
  const failed: string[] = [];
  const step = async (what: string, run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (err) {
      const paths = d.isNotesUnsavedError(err);
      if (paths) {
        failed.push(...paths.map((p) => d.describeNotes([p])));
      } else {
        failed.push(what);
      }
    }
  };
  try {
    d.prepareLeave();
    await step("the open drawing", d.flushDrawing);
    // Open notes: with autosave off, the user decides (Save / Don't save).
    if (
      decision.current === null &&
      d.notesAutosaveOff() &&
      d.unsavedNotePaths().length > 0
    ) {
      d.askAboutNotes();
      return;
    }
    if (decision.current !== "discard") {
      await step("notes", d.flushOpenNotes);
    }
    await step("the library", d.flushLibrary);
    await step("plugin data", d.flushPluginData);
    if (failed.length > 0) {
      d.askAboutDiscard(failed);
      return;
    }
    await d.destroyWindow();
    d.closed();
  } catch {
    d.askAboutDiscard(failed);
  } finally {
    // The window stayed open (or is gone): never remember the notes decision, so the next quit
    // asks again.
    decision.current = null;
  }
}
