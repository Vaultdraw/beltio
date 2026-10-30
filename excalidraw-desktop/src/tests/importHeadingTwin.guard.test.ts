import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Twin pin (validator, 2026-10-30, review of 181a745f, toimprove 187): the editor's fallback for
 * an imported heading with no stored body size (`markdownTyping.ts IMPORT_HEADING_SCALE`,
 * `IMPORT_DATA_KEYS`) copies the Markdown import's heading steps (`layout/fonts.ts HEADING_SCALE`)
 * and its data key (`plugins.<id>` from plugin.toml). New imports store `bodySize`, so the family
 * test no longer reaches the fallback: without this pin a change to the import's steps would leave
 * older imported notes with wrong body sizes, silently. Read as text: the plugin is outside the
 * desktop type check.
 */
const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const list = (src: string, name: string) =>
  /\[([^\]]+)\]/
    .exec(
      new RegExp(`const ${name}\\s*=\\s*\\[[^\\]]+\\]`).exec(src)?.[0] ?? "",
    )?.[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""));

describe("twin: the editor's copy of the import's heading steps", () => {
  const typing = read("src/markdown/markdownTyping.ts");
  it("IMPORT_HEADING_SCALE equals the import's HEADING_SCALE", () => {
    const fonts = read(
      "../plugins/official/markdown-import/src/layout/fonts.ts",
    );
    expect(list(typing, "IMPORT_HEADING_SCALE")).toEqual(
      list(fonts, "HEADING_SCALE"),
    );
    expect(list(typing, "IMPORT_HEADING_SCALE")?.length).toBe(6);
  });
  it("IMPORT_DATA_KEYS names the import's data key", () => {
    const id = /^id\s*=\s*"([^"]+)"/m.exec(
      read("../plugins/official/markdown-import/plugin.toml"),
    )?.[1];
    expect(list(typing, "IMPORT_DATA_KEYS")).toContain(`plugins.${id}`);
  });
});
