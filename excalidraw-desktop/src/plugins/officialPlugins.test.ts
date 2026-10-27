import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseToml } from "../../../sdk/cli/src/toml.mjs";

import {
  createsOwnDrawing,
  isOfficialPluginId,
  OFFICIAL_PLUGINS,
} from "./officialPlugins";

const manifest = (id: string) =>
  parseToml(
    readFileSync(
      resolve(__dirname, "../../../plugins/official", id, "plugin.toml"),
      "utf8",
    ),
  );

describe("the official plugin table (startup stubs)", () => {
  it.each(OFFICIAL_PLUGINS.map((p) => [p.id, p] as const))(
    "%s matches its plugin.toml",
    (id, plugin) => {
      const doc = manifest(id);
      expect(doc.id).toBe(id);
      expect(doc.name).toBe(plugin.name);
      const listed = doc.contributes.commands.filter(
        (c: { palette?: boolean }) => c.palette !== false,
      );
      expect(plugin.commands).toEqual(
        listed.map((c: { id: string; title: string }) => ({
          id: c.id,
          title: c.title,
        })),
      );
      if (plugin.cancelCommand) {
        expect(
          doc.contributes.commands.some(
            (c: { id: string }) => c.id === plugin.cancelCommand,
          ),
        ).toBe(true);
      }
      expect(plugin.importers).toEqual(
        doc.contributes.importers.map(
          (i: { id: string; title: string; extensions: string[] }) => ({
            id: i.id,
            title: i.title,
            extensions: i.extensions,
            ownDrawing: true,
          }),
        ),
      );
    },
  );

  it("no command has a default key (all rebindable, none taken)", () => {
    for (const p of OFFICIAL_PLUGINS) {
      for (const c of manifest(p.id).contributes.commands) {
        expect(c.keys ?? []).toEqual([]);
      }
    }
  });

  it("markdown-import never claims excalidraw.md", () => {
    const exts = OFFICIAL_PLUGINS.flatMap((p) =>
      p.importers.flatMap((i) => i.extensions),
    );
    expect(exts).toEqual(["md", "markdown"]);
  });

  it("knows its ids and which importers make their own drawing", () => {
    expect(isOfficialPluginId("markdown-import")).toBe(true);
    expect(isOfficialPluginId("hello")).toBe(false);
    expect(createsOwnDrawing("markdown-import")).toBe(true);
    expect(createsOwnDrawing("text-import")).toBe(false);
  });
});
