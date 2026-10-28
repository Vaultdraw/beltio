import { describe, expect, it } from "vitest";

import { isBuiltinCommand } from "./commands";
import { isLinkCommand, LINK_COMMAND_IDS } from "./linkCommands";

describe("link-callable commands (allow list)", () => {
  it("every listed id is a built-in command", () => {
    expect(LINK_COMMAND_IDS.filter((id) => !isBuiltinCommand(id))).toEqual([]);
  });

  it("allows the listed ids and drawing.open ids, nothing else", () => {
    expect(isLinkCommand("appearance.toggleMode")).toBe(true);
    expect(isLinkCommand("drawing.open:Graphs/BFS.excalidraw")).toBe(true);
    for (const id of [
      "config.resetOverrides",
      "profile.clearForVault",
      "plugins.restartSafeMode",
      "vault.rename",
      "file.save",
      "some.newCommand",
      "my.plugin.run",
    ]) {
      expect(isLinkCommand(id), id).toBe(false);
    }
  });
});
