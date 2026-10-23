/** Pure step of the Hotkeys page "Sequence" recorder: chords typed one by one. */
import type { Chord } from "../../../commands/types";

export type RecorderStep =
  | { action: "update"; chords: Chord[] }
  | { action: "confirm"; chords: Chord[] }
  | { action: "cancel" }
  | { action: "ignore" };

/**
 * `chord` is what was pressed (null = modifier only). Enter confirms,
 * Backspace drops the last chord, Escape cancels, anything else is appended
 * as the physical chord. Enter with nothing typed is ignored.
 */
export function stepRecorder(
  chords: readonly Chord[],
  chord: Chord | null,
): RecorderStep {
  switch (chord) {
    case null:
      return { action: "ignore" };
    case "Escape":
      return { action: "cancel" };
    case "Enter":
      return chords.length > 0
        ? { action: "confirm", chords: [...chords] }
        : { action: "ignore" };
    case "Backspace":
      return { action: "update", chords: chords.slice(0, -1) };
    default:
      return { action: "update", chords: [...chords, chord] };
  }
}
