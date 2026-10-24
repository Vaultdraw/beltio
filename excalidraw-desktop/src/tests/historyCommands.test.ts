import { describe, expect, it } from "vitest";

import { COMMANDS, getCommand, isCommandId } from "../commands/commands";
import { conflictCount, findConflicts } from "../commands/conflicts";
import { buildKeymap } from "../commands/keymap";
import { reservedReason } from "../commands/reserved";
import {
  HISTORY_COMMANDS,
  HISTORY_COMMAND_IDS,
} from "../history/historyCommands";

const IDS = Object.values(HISTORY_COMMAND_IDS);

describe("history commands", () => {
  it("defines every id once, in the registry, with History titles", () => {
    expect(IDS).toHaveLength(17);
    expect(HISTORY_COMMANDS.map((c) => c.id)).toEqual(IDS);
    expect(new Set(COMMANDS.map((c) => c.id)).size).toBe(COMMANDS.length);
    for (const id of IDS) {
      const command = getCommand(id)!;
      expect(isCommandId(id)).toBe(true);
      expect(command.category).toBe("History");
      expect(command.title.startsWith("History: ")).toBe(true);
    }
  });

  it("binds only checkpoint and toggle by default", () => {
    const bound = HISTORY_COMMANDS.filter((c) => c.keys.default.length > 0);
    expect(bound.map((c) => [c.id, c.keys.default])).toEqual([
      ["history.checkpoint", ["Mod+Alt+S"]],
      ["history.toggle", ["Mod+Shift+H"]],
    ]);
    for (const chord of ["Mod+Alt+S", "Mod+Shift+H"]) {
      expect(reservedReason(chord, "mac")).toBeNull();
      expect(reservedReason(chord, "win")).toBeNull();
    }
  });

  it("has no conflicts with the defaults on any platform", () => {
    for (const platform of ["mac", "win", "linux"] as const) {
      expect(conflictCount(findConflicts(COMMANDS, {}, platform))).toBe(0);
    }
  });

  it("reports a rebind onto another command's chord", () => {
    const result = findConflicts(
      COMMANDS,
      { "history.restoreCopy": ["Mod+Alt+S"] },
      "mac",
    );
    expect(result.get("history.restoreCopy")?.get("Mod+Alt+S")).toEqual([
      {
        kind: "command",
        id: "history.checkpoint",
        title: "History: Create checkpoint",
      },
    ]);
  });

  it("is rebindable and unbindable through [hotkeys]", () => {
    const rebound = buildKeymap(
      COMMANDS,
      { "history.checkpoint": ["Mod+Alt+Y"], "history.toggle": [] },
      "mac",
    );
    expect(rebound.get("Mod+Alt+Y")?.map((c) => c.id)).toEqual([
      "history.checkpoint",
    ]);
    expect(rebound.has("Mod+Alt+S")).toBe(false);
    expect(rebound.has("Mod+Shift+H")).toBe(false);
    const withNew = buildKeymap(
      COMMANDS,
      { "history.timeTravel": ["Mod+Alt+T"] },
      "mac",
    );
    expect(withNew.get("Mod+Alt+T")?.map((c) => c.id)).toEqual([
      "history.timeTravel",
    ]);
  });
});
