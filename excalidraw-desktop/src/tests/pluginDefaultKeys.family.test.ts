/**
 * Family hunter shell (2026-10-31): the default keys of the official plugins' commands reach their
 * command on every platform, like the core's (`defaultKeysPlatforms.family.test.ts`): none is
 * taken by the system or the app menu, none clashes with a core command or another plugin's
 * command that can be live at the same time.
 */
import { describe, expect, it } from "vitest";

import { COMMANDS } from "../commands/commands";
import { findConflicts } from "../commands/conflicts";
import { reservedInfo } from "../commands/reserved";
import { OFFICIAL_PLUGINS } from "../plugins/officialPlugins";

import type { CommandDefinition, Platform } from "../commands/types";

const pluginCommands: CommandDefinition[] = OFFICIAL_PLUGINS.flatMap((p) =>
  p.commands.map(
    (c) =>
      ({
        id: `plugin:${p.id}.${c.id}`,
        title: c.title,
        category: "Plugins",
        keys: { default: c.keys ?? [] },
        ...(c.when ? { when: c.when } : {}),
      } as unknown as CommandDefinition),
  ),
);

describe("family (shell hunter): official plugin default keys", () => {
  it("sanity: the plugins contribute commands with keys", () => {
    expect(pluginCommands.length).toBeGreaterThan(30);
    expect(
      pluginCommands.filter((c) => c.keys.default.length > 0).length,
    ).toBeGreaterThan(10);
  });

  for (const platform of ["mac", "linux", "win"] as Platform[]) {
    it(`${platform}: no plugin default chord is taken by the system or the app menu`, () => {
      const blocked = pluginCommands.flatMap((c) =>
        c.keys.default
          .filter((chord) => reservedInfo(chord, platform)?.blocked)
          .map((chord) => `${c.id} ${chord}`),
      );
      expect(blocked).toEqual([]);
    });

    it(`${platform}: no plugin default chord clashes with a core or plugin command`, () => {
      const map = findConflicts([...COMMANDS, ...pluginCommands], {}, platform);
      const clashes = pluginCommands
        .filter((c) => map.has(c.id))
        .map(
          (c) => `${c.id}: ${[...(map.get(c.id)?.keys() ?? [])].join(", ")}`,
        );
      expect(clashes).toEqual([]);
    });
  }
});
