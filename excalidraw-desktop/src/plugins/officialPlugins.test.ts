import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parseToml } from "../../../sdk/cli/src/toml.mjs";

import {
  createsOwnDrawing,
  importerMaxBytes,
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
      const listed = (doc.contributes.commands ?? []).filter(
        (c: { palette?: boolean }) => c.palette !== false,
      );
      expect(plugin.commands).toEqual(
        listed.map(
          (c: {
            id: string;
            title: string;
            keys?: string[];
            when?: string[];
            repeat?: boolean;
          }) => ({
            id: c.id,
            title: c.title,
            ...(c.keys?.length ? { keys: c.keys } : {}),
            ...(c.when?.length ? { when: c.when } : {}),
            ...(c.repeat ? { repeat: true } : {}),
          }),
        ),
      );
      if (plugin.cancelCommand) {
        expect(
          doc.contributes.commands.some(
            (c: { id: string }) => c.id === plugin.cancelCommand,
          ),
        ).toBe(true);
      }
      expect(
        (plugin.menus ?? []).map((m) => [
          m.surface,
          m.command,
          m.title,
          m.kinds,
        ]),
      ).toEqual(
        (doc.contributes.menus ?? []).map(
          (m: {
            surface: string;
            command: string;
            title: string;
            kinds: string[];
          }) => [m.surface, m.command, m.title, m.kinds],
        ),
      );
      expect(
        plugin.importers.map(({ id, title, extensions }) => ({
          id,
          title,
          extensions,
        })),
      ).toEqual(
        (doc.contributes.importers ?? []).map(
          (i: { id: string; title: string; extensions: string[] }) => ({
            id: i.id,
            title: i.title,
            extensions: i.extensions,
          }),
        ),
      );
    },
  );

  it("default keys are only those the table lists (all rebindable)", () => {
    for (const p of OFFICIAL_PLUGINS) {
      for (const c of manifest(p.id).contributes.commands ?? []) {
        const row = p.commands.find((x) => x.id === c.id);
        // A command hidden from the palette has no startup stub: its keys apply once the plugin runs.
        if (row || (c.keys ?? []).length === 0) {
          expect(c.keys ?? []).toEqual(row?.keys ?? []);
        }
      }
    }
  });

  it("the graph follows the [extensions] graph switch", () => {
    expect(OFFICIAL_PLUGINS.find((p) => p.id === "graph")?.extension).toBe(
      "graph",
    );
  });

  it("pdf-import follows the [extensions] pdf-import switch and takes PDFs up to 128 MiB", () => {
    const row = OFFICIAL_PLUGINS.find((p) => p.id === "pdf-import")!;
    expect(row.extension).toBe("pdf-import");
    expect(importerMaxBytes("pdf-import", "pdf", 1)).toBe(128 * 1024 * 1024);
    expect(importerMaxBytes("markdown-import", "md", 7)).toBe(7);
    expect(createsOwnDrawing("pdf-import")).toBe(false);
  });

  it("markdown-import never claims excalidraw.md", () => {
    const exts = OFFICIAL_PLUGINS.flatMap((p) =>
      p.importers.flatMap((i) => i.extensions),
    );
    expect(exts).toEqual(["md", "markdown", "pdf"]);
  });

  it("knows its ids and which importers make their own drawing", () => {
    expect(isOfficialPluginId("markdown-import")).toBe(true);
    expect(isOfficialPluginId("hello")).toBe(false);
    expect(createsOwnDrawing("markdown-import")).toBe(true);
    expect(createsOwnDrawing("text-import")).toBe(false);
  });
});
