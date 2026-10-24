import fs from "node:fs";

import { describe, expect, it } from "vitest";

import {
  DESCRIPTIONS,
  DOC_FILE,
  generate,
  tokenNames,
} from "../scripts/gen-theme-docs.mjs";
import { TOKEN_NAMES } from "../../../excalidraw-desktop/src/theme/types";

describe("sdk/docs/theme-tokens.md", () => {
  it("matches what ThemeTokenName generates", () => {
    const actual: string = generate();
    if (process.env.UPDATE_THEME_DOCS === "1") {
      fs.writeFileSync(DOC_FILE, actual);
      return;
    }
    expect(
      actual === fs.readFileSync(DOC_FILE, "utf8"),
      "sdk/docs/theme-tokens.md is out of date. Run " +
        "`node sdk/api/scripts/gen-theme-docs.mjs` and commit it.",
    ).toBe(true);
  });

  it("documents exactly the tokens the app derives", () => {
    expect([...tokenNames()].sort()).toEqual([...TOKEN_NAMES].sort());
    expect(Object.keys(DESCRIPTIONS).sort()).toEqual([...TOKEN_NAMES].sort());
  });

  it("gives every token a one-line description", () => {
    for (const [name, text] of Object.entries<string>(DESCRIPTIONS)) {
      expect(text.length, name).toBeGreaterThan(5);
      expect(text, name).not.toContain("\n");
    }
  });
});
