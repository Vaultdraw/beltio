import { useSyncExternalStore } from "react";

import {
  getPreferences,
  subscribePreferences,
  updatePreferences,
} from "../../vault/preferences";
import { ChoiceGroup, SwitchRow } from "../controls";

import type { StepProps } from "../types";

/** Save delays offered; anything else in config.toml is left as it is. */
export const SAVE_SPEEDS = [
  { value: 500, label: "Quick", hint: "half a second after you stop" },
  { value: 2000, label: "Relaxed", hint: "two seconds" },
  { value: 5000, label: "Slow", hint: "five seconds" },
] as const;

export const LINE_STYLES = [
  { value: 0, label: "Clean", hint: "straight, precise lines" },
  { value: 1, label: "Hand-drawn", hint: "Excalidraw's look" },
  { value: 2, label: "Rough", hint: "extra sketchy" },
] as const;

export const Basics = ({ env }: StepProps) => {
  const { win } = env;
  const prefs = useSyncExternalStore(
    subscribePreferences,
    () => getPreferences(win),
    () => getPreferences(win),
  );
  return (
    <>
      <SwitchRow
        id="setup-vim"
        label="Vim-style keys in notes"
        hint="Modal editing when you write Markdown notes."
        checked={prefs.notesVim}
        onChange={(notesVim) => updatePreferences({ notesVim }, win)}
      />
      <SwitchRow
        id="setup-markdown"
        label="Markdown mode in new drawings"
        hint="Type # and a space to make a heading, right on the canvas."
        checked={prefs.markdownTyping}
        onChange={(markdownTyping) =>
          updatePreferences({ markdownTyping }, win)
        }
      />
      <ChoiceGroup<number>
        name="setup-save"
        label="Saving"
        value={prefs.autosaveDelayMs}
        columns={3}
        options={SAVE_SPEEDS.map((o) => ({ ...o }))}
        onChange={(autosaveDelayMs) =>
          updatePreferences({ autosaveDelayMs }, win)
        }
      />
      <ChoiceGroup<number>
        name="setup-lines"
        label="Line style of new shapes"
        value={prefs.defaultRoughness}
        columns={3}
        options={LINE_STYLES.map((o) => ({ ...o }))}
        onChange={(defaultRoughness) =>
          updatePreferences({ defaultRoughness }, win)
        }
      />
    </>
  );
};
