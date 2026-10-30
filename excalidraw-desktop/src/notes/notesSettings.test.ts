import { describe, expect, it } from "vitest";

import {
  NOTES_DEFAULTS,
  NOTES_MAPPINGS,
  normalizeNotesPreferences,
} from "./notesSettings";

describe("notes settings", () => {
  it("every field has a mapping and a valid default", () => {
    for (const m of NOTES_MAPPINGS) {
      expect(
        m.valid(NOTES_DEFAULTS[m.field as keyof typeof NOTES_DEFAULTS]),
      ).toBe(true);
      expect(m.key.startsWith("notes.")).toBe(true);
    }
    expect(NOTES_MAPPINGS).toHaveLength(Object.keys(NOTES_DEFAULTS).length);
  });

  it("shows web pictures by default (Offline mode is the switch that stops them)", () => {
    expect(NOTES_DEFAULTS.notesRemoteImages).toBe(true);
  });

  it("bad stored values fall back to the defaults", () => {
    const n = normalizeNotesPreferences({
      notesOpenIn: "nope",
      notesFontSize: 3,
      notesVim: "yes",
      notesAutosaveMs: 250,
    });
    expect(n.notesOpenIn).toBe("reading");
    expect(n.notesFontSize).toBe(NOTES_DEFAULTS.notesFontSize);
    expect(n.notesVim).toBe(false);
    expect(n.notesAutosaveMs).toBe(250);
  });
});
