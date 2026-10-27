import { describe, expect, it } from "vitest";

import { parseManifest, readExample } from "./readManifest";

const BASE = `id = "demo"\nname = "Demo"\nversion = "0.1.0"\napi = 0\nmain = "main.js"\n`;

describe("parseManifest", () => {
  it("applies defaults for optional keys", () => {
    const info = parseManifest(
      `${BASE}[[contributes.commands]]\nid = "go"\ntitle = "Go"\n[[contributes.panels]]\nid = "p"\ntitle = "P"\n`,
      42,
    );
    expect(info).toMatchObject({
      id: "demo",
      api: 0,
      minApp: null,
      description: null,
      source: "bundled",
      compatible: true,
      problem: null,
      hostDisabled: null,
      activation: [],
      mainBytes: 42,
    });
    expect(info.contributes.commands).toEqual([
      {
        id: "go",
        title: "Go",
        keys: [],
        when: [],
        palette: true,
        repeat: false,
      },
    ]);
    expect(info.contributes.panels).toEqual([
      { id: "p", title: "P", icon: null, group: "top" },
    ]);
  });

  it("parses strings, numbers, bools, arrays and comments", () => {
    const info = parseManifest(
      `# header\n${BASE}description = "a # not a comment, \\"quoted\\""  # real comment\nactivation = ["onStartupFinished",]\n` +
        `[[contributes.commands]]\nid = "go"\ntitle = "Go"\nkeys = ["Mod+Alt+H", "Mod+K"]\nwhen = ["vaultOpen"]\npalette = false\n` +
        `[[contributes.settings]]\nkey = "n"\ntype = "number"\ndefault = 1.5\n[x-extra]\nanything = "ignored"\n`,
    );
    expect(info.description).toBe('a # not a comment, "quoted"');
    expect(info.activation).toEqual(["onStartupFinished"]);
    expect(info.contributes.commands[0]).toMatchObject({
      keys: ["Mod+Alt+H", "Mod+K"],
      when: ["vaultOpen"],
      palette: false,
    });
    expect(info.contributes.settings).toEqual([
      { key: "n", type: "number", default: 1.5 },
    ]);
  });

  it("throws outside the subset", () => {
    expect(() => parseManifest(`${BASE}bogus = 1\n`)).toThrow(
      /unknown top-level/,
    );
    expect(() => parseManifest(`${BASE}[contributes]\n`)).toThrow(
      /unsupported table/,
    );
    expect(() => parseManifest(`${BASE}[[other]]\n`)).toThrow(
      /unsupported table/,
    );
    expect(() => parseManifest(`${BASE}description = 'single'\n`)).toThrow(
      /unsupported value/,
    );
    expect(() => parseManifest(`${BASE}activation = [1, 2]\n`)).toThrow(
      /unsupported value/,
    );
    expect(() => parseManifest(`${BASE}not toml\n`)).toThrow(/cannot parse/);
  });
});

describe("readExample", () => {
  it("reads an example folder with the size of main.js", () => {
    const info = readExample("hello-command");
    expect(info.id).toBe("hello-command");
    expect(info.mainBytes).toBeGreaterThan(0);
  });
});
