import { describe, expect, it } from "vitest";

import { SETTINGS_SCHEMA } from "../components/settings/schema";

import { getCommand } from "./commands";
import { withShortcuts, withoutShortcuts } from "./shortcutText";

describe("withShortcuts", () => {
  it("shows the live binding, or drops the whole parenthesis when none", () => {
    const text = "Focus mode ({{key:view.focusMode}}) hides it.";
    expect(withShortcuts(text, () => "Cmd+K")).toBe(
      "Focus mode (Cmd+K) hides it.",
    );
    expect(withShortcuts(text, () => "")).toBe("Focus mode hides it.");
    expect(withoutShortcuts(text)).toBe("Focus mode hides it.");
  });

  // Family: every key token in a Settings description names a real command.
  it("every {{key:id}} token in the Settings schema is a registered command", () => {
    const ids = SETTINGS_SCHEMA.flatMap((s) =>
      [...s.description.matchAll(/\{\{key:([\w.:-]+)\}\}/g)].map((m) => m[1]),
    );
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(getCommand(id), id).toBeDefined();
    }
  });

  // Family: no Settings text names a fixed key; it uses a token or plain words.
  it("no Settings description hard-codes a key combination", () => {
    for (const s of SETTINGS_SCHEMA) {
      expect(withoutShortcuts(s.description), s.id).not.toMatch(
        /\b(Cmd|Ctrl|Alt|Option)\s*\+\s*[A-Z0-9]|⌘|⌥/,
      );
    }
  });
});
